/*
    TRS Dizen — kendi pencere yerleştirme kuralımız (KWin betiği). Sürüm 3.

    HANGİ DURUMDA NE OLUR
    ─────────────────────
    Her sanal masaüstü ve her ekran ayrı hesaplanır. Bir masaüstündeki "sayılan" pencere sayısı n:

      n = 1      pencere ekranı tamamen kaplar ("-hep" kurallılar hariç: onlar tek başına da yarıda durur)
      n = 2      biri sol yarı, biri sağ yarı. Kuralı olan kendi yarısına gider, kuralsız olan karşısına;
                 ikisi de kuralsızsa önce açılan sola
      n >= 3     yeni gelen kuralsız pencere rastgele bir yarıya gider (bir kez seçilir, sonra değişmez)
                 ve o yarıdakinin üstüne gelir; kurallılar kendi yarısına
      çakışma    yarım pencerelerin hepsi aynı yarıya düşer ve öbür yarı boş kalırsa, EN AZ ÜSTÜN olan
                 karşıya geçer. Üstünlük = kural listesindeki sıra; kuralsızlar en az üstündür;
                 eşitlikte sonradan açılan geçer

    Öncelik (üstteki alttakini ezer):
      1. Elle müdahale   taşıdığın, boyutlandırdığın, büyüttüğün/küçülttüğün ya da kenara yasladığın
                         pencereye KAPANANA KADAR dokunulmaz. O pencere yine sayılır ve durduğu yarı
                         "dolu" kabul edilir (öbürleri ona göre yerleşir)
                         Tek istisna: masaüstünde YALNIZKEN tam duran (elle büyütülmüş ya da hatıradan
                         büyük açılmış) pencere, yanına sayılan yeni bir pencere gelince elle sayılmaktan
                         çıkar ve kurala göre bölünür (ör. Firefox tamken Sublime açılır: Sublime sol,
                         Firefox sağ). Başka pencereler varken büyüttüğün pencereye yine dokunulmaz
      2. Kurallar        aşağıdaki yer türleri
      3. Genel kural     yukarıdaki n tablosu

    Elle müdahale nasıl anlaşılır (süreye değil, olayın kendisine bakılır):
      büyütme / küçültme   betiğin kendi çağrısı dışında gelen her istek elledir. Tek istisna: pencere
                           açıldıktan sonraki ilk 1,5 saniyede gelen İLK istek programın eski hâlini geri
                           yüklemesi sayılır ve kural yeniden uygulanır; ikincisi elledir (çekişme olmaz)
      kenara yaslama       pencere bir döşemeye GİRDİYSE elledir (betik hiç döşemez). Döşemeden çıkması
                           betiğin taşımasının gecikmeli yankısı olabilir, elle sayılmaz
      taşıma / boyutlama   sürükleme bitince, pencere oynadıysa elledir. Tutup oynatmadan bırakmak sayılmaz
      sürüklerken          bırakılana kadar o pencereye dokunulmaz, öbürleri de ona göre yer değiştirmez

    Yer türleri:
      "sag" / "sol"          2+ pencere varken o yarı; tek başınaysa tam ekran
      "sag-hep" / "sol-hep"  tek başına bile o yarı
      "tam"                  hep tam ekran
      "orta"                 ortada, belirli oranda; sonra dokunulmaz, sayılmaz
      "yardimci"             kendi boyutunda, ortada; sayılmaz
      "genel"                kuralsız say (daha geniş bir kuralın bir programı yutmasını önlemek için)

    Sayılmayan ve hiç dokunulmayan pencereler:
      "her zaman üstte" olanlar · birden çok (ya da bütün) masaüstünde görünenler · birden çok etkinlikte
      görünenler (yalnızca birden fazla etkinlik varsa) · boyutu değiştirilemeyenler · görev çubuğunda
      görünmeyenler · HARIC listesindekiler · simge durumuna küçültülmüş olanlar (geri gelince sayılır)

    Tam ekran (F11, video) pencere: sayılmaya devam eder ama dokunulmaz; böylece video izlerken
    öbür pencereler yer değiştirmez.

    Bağlı pencereler (bir pencereye bağlı iletişim kutusu, uyarı, dosya seçici): sayılmaz, boyutuna
    dokunulmaz. Açıldığı andaki yeri ana pencereye göre kaydedilir; ana pencere nereye giderse (betik
    taşısın ya da sen taşı) bağlı pencere de aynı kadar gider. Bağlı pencereyi elle taşırsan izlemeyi bırakır.

    Yardımcı pencereler (programın bağlı olduğunu BİLDİRMEDİĞİ küçük pencereler: açılış seçici, ilerleme kutusu):
      açıldığı anda küçükse (en <= alanın %50'si ve boy <= %62'si):
        kuralsız program           → yardımcı
        "orta" kurallı program     → yardımcı (boyutu korunur)
        yarı/tam kurallı program   → yalnızca aynı programın başka bir ana penceresi açıksa yardımcı
      yardımcı pencere kendi boyutunda, ana pencerenin (yoksa ekranın) ortasına konur ve ana pencereyi
      bağlı pencere gibi izler. Sonradan kendiliğinden büyürse (ne zaman olursa olsun) yardımcı
      sayılmaktan çıkar ve olağan pencere gibi yerleştirilir.

    Programın kimliği sonradan belli olursa ya da kuralı değişirse: pencere yeni açılmış gibi yeniden
    değerlendirilir. Kuralı DEĞİŞMEYEN pencereler yerinden oynamaz.

    Betik yeniden yüklenirse (trs-dizen kur): hiçbir pencere yerinden oynamaz. Eski betik durumunu
    (elle işaretleri, seçilmiş yarılar) yenisine devreder; devir yoksa o an kurala uygun duranlar
    yönetilmeye devam eder, uymayanlar "elle yerleştirilmiş" kabul edilir.

    Kurallar ~/.config/trs/dizen-kurallar.json dosyasından gelir; "trs-dizen" onları kwinrc içindeki
    [Script-trsdizen] Kurallar anahtarına yazar ve KWin'e ayarları yeniden okutur. Aşağıdaki
    VARSAYILAN yalnızca o anahtar yokken kullanılır.

    Sınama: "trs-dizen sina" bu dosyayı sahte bir pencere yöneticisinde senaryolarla çalıştırır.
*/

// ── Ayarlar ────────────────────────────────────────────────────────────────────────────────────
const ORTA_EN = 0.58;           // "orta" pencerenin alana oranı (kuralda en/boy yoksa)
const ORTA_BOY = 0.70;
const YARDIMCI_EN = 0.50;       // bundan küçük açılan pencere yardımcı adayıdır
const YARDIMCI_BOY = 0.62;
const BEKLEME = 90;             // art arda gelen olayları tek dizmede toplama süresi (ms)
let KAPANIS_BEKLEME = 260;      // pencere kapanınca kalanları dizmeden önce beklenen süre (ms): kapanış
                                // canlandırması bitsin; art arda kapanan pencereler (çok pencereli programdan
                                // çıkış, oturumu kapatma, programın yeniden başlaması) tek dizmede toplansın
const IZLEME = 60;              // boyut/konum değişimlerini tek izleme geçişinde toplama süresi (ms)
const ISTEK_SURE = 1000;        // bir isteğin yanıtlanması için tanınan süre (ms); sonra denetlenir
const DENEME = 3;               // pencere istenen yere gelmiyorsa en çok kaç kez yeniden istenir
let DOGUM_SURE = 1500;          // açılıştan sonra programın kendi yaptığı büyütmeyi yok sayma süresi (ms)
const DOGUM_BUYUTME = 1;        // o süre içinde programa en çok kaç büyütme tanınır; fazlası elledir
let KURAL_HEMEN = true;         // kural değişince açık pencereler hemen yeni yerine geçsin (false: yeni açılışta)
// Yukarıdaki üç karar kullanıcıca değiştirilebilir (TRS Durum → Davranış): kwinrc [Script-trsdizen]
// KararDogumMs (0–5000), KararKapanisMs (0–2000), KararKuralHemen (1/0). Yoksa ya da geçersizse varsayılan kalır.
const TOLERANS = 2;             // "zaten yerinde" sayılması için piksel payı

const YERLER = ["tam", "sag", "sol", "sag-hep", "sol-hep", "orta", "yardimci", "genel"];

// Kural biçimi: [ara, yer, en?, boy?]. Eşleşme türleri için desenYap() işlevine bak.
// İlk eşleşen kural geçerlidir; sıra aynı zamanda üstünlük sırasıdır.
const VARSAYILAN = {
    k: [
        ["firefox", "sag"], ["konsole", "sol"], ["~sublime", "sag-hep"], ["jetbrains-studio", "tam"],
        ["discord", "orta"], ["eclipse", "orta", 0.80, 0.90], ["idea", "tam"], ["codium", "tam"],
        ["dolphin", "sol"], ["kate", "sol"], ["okular", "sag"], ["systemsettings", "orta"],
        ["org.freedesktop.impl.portal", "yardimci"], ["xdg-desktop-portal", "yardimci"]
    ],
    h: ["net.trs.pano", "ksplashqml", "plasmashell", "krunner", "kscreenlocker", "xwaylandvideobridge"]
};

let KURALLAR = [];
let HARIC = [];
let kuralSurumu = 0;            // kurallar her değiştiğinde artar; pencere başına önbelleği geçersiz kılar
let kuralMetni = null;

// Dört eşleşme türü:
//   "=org.kde.kate"    pencere sınıfı ya da kimliği birebir bu (kurulu programlar böyle yazılır)
//   "~sublime"         sınıfın ya da kimliğin içinde geçmesi yeter
//   "jetbrains-studio" içinde nokta/tire/boşluk var: yine içinde geçmesi yeter
//   "ark"              yalın sözcük: sınıfın bir parçasıyla birebir aynı olmalı ("dark" ile eşleşmez)
function desenYap(ara) {
    const a = String(ara).toLowerCase();
    if (a.charAt(0) === "=") {
        return { ara: a.substring(1), tur: "tam" };
    }
    if (a.charAt(0) === "~") {
        return { ara: a.substring(1), tur: "icinde" };
    }
    return { ara: a, tur: /[.\- ]/.test(a) ? "icinde" : "parca" };
}

function oran(v) {                                    // saçma oran (0, eksi, 4 kat) gelirse yok say
    return typeof v === "number" && v >= 0.2 && v <= 1 ? v : undefined;
}

function kurallariKur(veri) {
    const k = [];
    const h = [];
    for (const s of veri.k) {
        if (!s || typeof s[0] !== "string" || YERLER.indexOf(s[1]) === -1) {
            continue;                                 // bozuk satır: atla, gerisini kullan
        }
        const d = desenYap(s[0]);
        if (!d.ara) {
            continue;
        }
        d.yer = s[1];
        d.en = oran(s[2]);
        d.boy = oran(s[3]);
        d.ozet = d.yer + ":" + (d.en || "") + ":" + (d.boy || "");
        k.push(d);
    }
    for (const s of (veri.h || [])) {
        if (typeof s === "string" && desenYap(s).ara) {
            h.push(desenYap(s));
        }
    }
    if (k.length === 0) {
        throw new Error("kural listesi boş");
    }
    KURALLAR = k;
    HARIC = h;
    kuralSurumu++;
    hatira.clear();                                   // kural değişti: eski elle yerler geçersiz
}

function kararlariOku() {
    const sayi = function(ad, varsayilan, enAz, enCok) {
        const m = ayarOku(ad);
        const n = parseInt(m, 10);
        return m !== "" && !isNaN(n) && n >= enAz && n <= enCok ? n : varsayilan;
    };
    DOGUM_SURE = sayi("KararDogumMs", 1500, 0, 5000);
    KAPANIS_BEKLEME = sayi("KararKapanisMs", 260, 0, 2000);
    KURAL_HEMEN = ayarOku("KararKuralHemen") !== "0";
}

// kwinrc'deki kuralları okur. Değiştiyse true döner. Bozuksa eldeki kurallar kalır.
function kurallariYukle() {
    const metin = ayarOku("Kurallar");
    if (metin === kuralMetni) {
        return false;
    }
    kuralMetni = metin;
    try {
        kurallariKur(metin ? JSON.parse(metin) : VARSAYILAN);
    } catch (hata) {
        print("trsdizen: kurallar okunamadı, eldeki kullanılıyor: " + hata);
        if (KURALLAR.length === 0) {
            kurallariKur(VARSAYILAN);
        }
    }
    return true;
}

function ayarOku(ad) {
    try {
        return String(readConfig(ad, ""));
    } catch (hata) {
        return "";
    }
}

// ── Pencere kayıtları ──────────────────────────────────────────────────────────────────────────
const durum = new Map();        // pencere kimliği → kayıt
const pencereler = new Map();   // pencere kimliği → sinyalleri bağlanmış pencere
let sayac = 0;
let kendiCagri = 0;             // > 0 iken pencereyi BİZ değiştiriyoruz (eşzamanlı sinyaller bize ait)
const sayaclar = { diz: 0, islem: 0 };   // sınama ve teşhis için
// Elle yerleştirilip kapanan programın yeri (tepsiye kapanan Discord gibi): program kimliği → yer.
// Aynı program yeniden açılınca (başka penceresi yoksa) oraya konur ve elle sayılır. Yalnız bellekte;
// kurallar değişince ya da sıfırlamada silinir.
const hatira = new Map();
const HATIRA_EN_COK = 42;

function programAdi(w) {
    return String(w.desktopFileName || w.resourceClass || "").toLowerCase();
}

function programinBaskaPenceresi(w, ad) {
    for (const o of pencereler.values()) {
        if (o !== w && !o.deleted && (o.normalWindow && !o.transient) && programAdi(o) === ad) {
            return true;
        }
    }
    return false;
}

function hatirla(w, d) {
    const ad = programAdi(w);
    if (!ad || !d.elle || d.yardimci || d.haric || !w.normalWindow || w.transient || w.dialog
        || w.fullScreen || !w.output || programinBaskaPenceresi(w, ad)) {
        return;
    }
    const g = w.frameGeometry;
    hatira.delete(ad);
    hatira.set(ad, { g: { x: g.x, y: g.y, width: g.width, height: g.height }, ekran: w.output,
                     buyuk: w.maximizeMode === 3 });
    if (hatira.size > HATIRA_EN_COK) {
        hatira.delete(hatira.keys().next().value);    // en eskisi
    }
}

// Yeni pencere hatırlanan programınsa eski yerine koy. Konduysa true.
function hatiradanKoy(w, d) {
    const ad = programAdi(w);
    const h = hatira.get(ad);
    if (!h || !ilgili(w) || d.yardimci || w.output !== h.ekran || programinBaskaPenceresi(w, ad)) {
        return false;
    }
    hatira.delete(ad);
    d.elle = true;
    d.sonKural = d.haric ? "haric" : (d.kuralNo === -1 ? "" : KURALLAR[d.kuralNo].ozet);
    degistir(function () {
        if (h.buyuk) {
            w.setMaximize(true, true);
        } else {
            w.frameGeometry = h.g;
        }
    });
    return true;
}

function kimlik(w) {
    return String(w.internalId);
}

function kayit(w) {
    const k = kimlik(w);
    let d = durum.get(k);
    if (!d) {
        d = {
            elle: false,        // kullanıcı dokundu: bir daha yerleştirme
            taraf: "",          // kuralsız pencerenin seçilmiş yarısı ("sol" | "sag")
            sira: sayac++,      // açılış sırası
            dogum: Date.now(),
            dogumBuyutme: 0,    // açılış süresinde programa tanınan büyütme sayısı
            yardimci: false,
            yardimciOto: false, // boyuta bakılarak yardımcı sayıldı (kuralla değil)
            ana: "",            // yardımcının bağlı olduğu ana pencerenin kimliği
            yerlesti: false,    // yardımcı bir kez ortalandı (ana penceresi yoksa bir daha dokunulmaz)
            ofs: null,          // bağlı/yardımcı pencerenin merkezinin ana pencere merkezine uzaklığı
            istek: "",          // pencereden en son istediğimiz yer
            istekZamani: 0,
            deneme: 0,          // aynı yer için art arda yapılan istek sayısı
            yer: "",            // betiğin bu pencere için en son hesapladığı yer ("tam" | "sol" | "sag")
            sinif: null, surum: -1, kuralNo: -1, haric: false,   // sınıflandırma önbelleği
            sonKural: null,     // en son görülen kural özeti (değişimi yakalamak için)
            tasiniyor: false,   // kullanıcı şu an sürüklüyor/boyutlandırıyor
            tasimaBasi: null,
            tasimaOynadi: false,
            sayildi: false,     // son dizmede yerleşim hesabına girdi mi
            sonGrupBoyu: 0      // son dizmede masaüstündeki sayılan pencere sayısı (0: sayılmadı)
        };
        durum.set(k, d);
    }
    return d;
}

function sinifMetni(w) {
    return (String(w.resourceClass || "") + " " + String(w.desktopFileName || "")).toLowerCase();
}

function eslesir(b, desen) {
    if (desen.tur === "tam") {
        return b.sinif === desen.ara || b.dosya === desen.ara;
    }
    return desen.tur === "icinde" ? b.metin.indexOf(desen.ara) !== -1 : b.parcalar.indexOf(desen.ara) !== -1;
}

// Pencerenin kuralını ve HARIC durumunu bulur; sınıf ya da kurallar değişmedikçe yeniden hesaplamaz
function siniflandir(w, d) {
    const s = sinifMetni(w);
    if (d.sinif === s && d.surum === kuralSurumu) {
        return;
    }
    d.sinif = s;
    d.surum = kuralSurumu;
    const b = {
        metin: s,
        parcalar: s.split(/[^a-z0-9]+/),
        sinif: String(w.resourceClass || "").toLowerCase(),
        dosya: String(w.desktopFileName || "").toLowerCase()
    };
    d.haric = false;
    for (const h of HARIC) {
        if (eslesir(b, h)) {
            d.haric = true;
            break;
        }
    }
    d.kuralNo = -1;
    for (let i = 0; i < KURALLAR.length; i++) {
        if (eslesir(b, KURALLAR[i])) {
            d.kuralNo = KURALLAR[i].yer === "genel" ? -1 : i;
            break;
        }
    }
}

function cokEtkinlik() {
    try {
        const a = workspace.activities;
        return !!a && a.length > 1;
    } catch (hata) {
        return false;
    }
}

// Pencere neden sayılmıyor? Sayılıyorsa "" döner. (Her seferinde canlı bakılır: özellikler değişebilir)
function neden(w) {
    if (!w || w.deleted) {
        return "yok";
    }
    if (w.dialog) {
        return "iletisim";
    }
    if (!w.normalWindow) {
        return "ozel";
    }
    if (w.transient) {
        return "bagli";
    }
    if (w.keepAbove) {
        return "ustte";
    }
    if (!w.resizeable && !w.fullScreen) {            // tam ekrandaki pencere KWin'e göre "boyutlanamaz"dır;
        return "sabit-boyut";                         // yine de sayılmalı, yoksa video açınca öbürleri kayar
    }
    if (w.skipTaskbar) {
        return "gorev-cubugunda-yok";
    }
    if (!w.output || !w.desktops) {
        return "ekransiz";
    }
    if (w.desktops.length !== 1) {
        return w.desktops.length === 0 ? "tum-masaustleri" : "cok-masaustu";
    }
    if (cokEtkinlik() && (!w.activities || w.activities.length !== 1)) {
        return "cok-etkinlik";
    }
    const d = kayit(w);
    siniflandir(w, d);
    return d.haric ? "haric-listesi" : "";
}

function ilgili(w) {
    return neden(w) === "";
}

// Başka bir pencereye bağlı olduğunu programın kendisi bildirmiş pencere (iletişim kutusu, uyarı)
function bagliCocuk(w) {
    if (!w || w.deleted || !(w.normalWindow || w.dialog) || !w.transient || w.popupWindow || !w.output) {
        return false;
    }
    let ana = null;
    try {
        ana = w.transientFor;
    } catch (hata) {
        ana = null;
    }
    if (!ana || ana.deleted) {
        return false;
    }
    const d = kayit(w);
    siniflandir(w, d);
    return !d.haric;
}

function kuralNo(w) {
    const d = kayit(w);
    siniflandir(w, d);
    return d.kuralNo;
}

function kural(w) {
    const i = kuralNo(w);
    return i === -1 ? "" : KURALLAR[i].yer;
}

function ustunluk(w) {                                // küçük sayı = daha üstün
    const i = kuralNo(w);
    return i === -1 ? KURALLAR.length : i;
}

function alan(w) {
    const m = w.desktops && w.desktops.length ? w.desktops[0] : workspace.currentDesktop;
    return workspace.clientArea(KWin.MaximizeArea, w.output, m);
}

function yakin(a, b) {
    return Math.abs(a.x - b.x) <= TOLERANS && Math.abs(a.y - b.y) <= TOLERANS
        && Math.abs(a.width - b.width) <= TOLERANS && Math.abs(a.height - b.height) <= TOLERANS;
}

function anahtar(g) {
    return Math.round(g.x) + "," + Math.round(g.y) + "," + Math.round(g.width) + "," + Math.round(g.height);
}

function merkez(g) {
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
}

function yariDikdortgen(a, taraf) {
    const yari = Math.floor(a.width / 2);
    return {
        x: taraf === "sol" ? a.x : a.x + yari,
        y: a.y,
        width: taraf === "sol" ? yari : a.width - yari,
        height: a.height
    };
}

function karsi(taraf) {
    return taraf === "sol" ? "sag" : "sol";
}

// Pencerenin şu an durduğu yer: "tam" | "sol" | "sag" | "" (hiçbiri)
function durduguYer(w) {
    if (w.maximizeMode === 3) {
        return "tam";
    }
    const a = alan(w);
    const g = w.frameGeometry;
    if (yakin(g, yariDikdortgen(a, "sol"))) {
        return "sol";
    }
    if (yakin(g, yariDikdortgen(a, "sag"))) {
        return "sag";
    }
    if (yakin(g, a)) {
        return "tam";
    }
    return "";
}

// Dokunulmayan (elle ya da tam ekran) pencerenin kapladığı yarı: öbürleri karşısına yerleşsin diye
function kapladigiYari(w) {
    if (w.fullScreen || w.maximizeMode === 3) {
        return "";
    }
    const a = alan(w);
    const g = w.frameGeometry;
    if (g.width > a.width * 0.75) {
        return "";                                    // ekranın çoğunu kaplıyor: yarı sayılmaz
    }
    return (g.x + g.width / 2) < (a.x + a.width / 2) ? "sol" : "sag";
}

// ── Pencereyi değiştiren işlemler (hepsi buradan geçer) ────────────────────────────────────────
function degistir(is) {
    sayaclar.islem++;
    kendiCagri++;
    try {
        is();
    } finally {
        kendiCagri--;
    }
}

// Pencereden bir yere gitmesini ister. Pencereler isteğe GECİKMELİ yanıt verebilir; o yüzden
// gözlenen durum her zaman güncel değildir:
//   aynı istek yoldaysa        yinelenmez, süre dolunca denetlenir
//   pencere yerinde, yolda başka istek yoksa   hiçbir şey yapılmaz
//   pencere yerinde ama yolda BAŞKA istek varsa  o istek pencereyi buradan götürecektir: yeniden istenir
//   pencere bir türlü gelmiyorsa  DENEME kez yinelenir, sonra bırakılır (çekişme olmaz)
function istekYap(w, d, ad, zatenOrada, is) {
    const simdi = Date.now();
    const ucusta = simdi - d.istekZamani < ISTEK_SURE;
    if (ucusta && d.istek === ad) {
        dogrula();
        return;
    }
    if (zatenOrada && !ucusta) {
        d.istek = ad;
        d.deneme = 0;
        return;
    }
    d.deneme = d.istek === ad ? d.deneme + 1 : 1;
    if (d.deneme > DENEME) {
        return;
    }
    d.istek = ad;
    d.istekZamani = simdi;
    degistir(is);
    dogrula();
}

function istegiUnut(d) {
    d.istek = "";
    d.istekZamani = 0;
}

function dosendiMi(w) {
    try {
        return !!w.tile;
    } catch (hata) {
        return false;
    }
}

// Kenara yaslanmış (döşenmiş) pencereyi serbest bırak: yoksa döşeme onu geri çekebilir
function doseyiBirak(w) {
    try {
        const t = w.tile;
        if (t) {
            t.unmanage(w);
        }
    } catch (hata) {
        // bu KWin sürümünde yok: pencere yine de taşınır
    }
}

function tamYap(w, d) {
    istekYap(w, d, "tam", w.maximizeMode === 3, function () {
        if (w.maximizable === false) {
            doseyiBirak(w);
            w.frameGeometry = alan(w);                // büyütülemeyen pencere: alanı elle kaplat
        } else {
            w.setMaximize(true, true);
        }
    });
}

function yereKoy(w, d, hedef, ad) {
    // az önce "tam" istediysek pencere henüz büyümemiş görünse de büyüyecektir: önce onu geri al
    const tamYolda = d.istek === "tam" && Date.now() - d.istekZamani < ISTEK_SURE;
    istekYap(w, d, ad, w.maximizeMode === 0 && yakin(w.frameGeometry, hedef), function () {
        if (w.maximizeMode !== 0 || tamYolda) {
            w.setMaximize(false, false);
        }
        doseyiBirak(w);
        w.frameGeometry = { x: hedef.x, y: hedef.y, width: hedef.width, height: hedef.height };
    });
}

function ortaYap(w, d) {
    const a = alan(w);
    const k = KURALLAR[kuralNo(w)];
    const en = Math.round(a.width * (k && k.en ? k.en : ORTA_EN));
    const boy = Math.round(a.height * (k && k.boy ? k.boy : ORTA_BOY));
    const hedef = {
        x: a.x + Math.round((a.width - en) / 2),
        y: a.y + Math.round((a.height - boy) / 2),
        width: en,
        height: boy
    };
    yereKoy(w, d, hedef, "orta:" + anahtar(hedef));
}

// ── Zamanlayıcılar ─────────────────────────────────────────────────────────────────────────────
function tekAtim(ms, is, ad) {
    const t = new QTimer();
    t.singleShot = true;
    t.interval = ms;
    t.timeout.connect(function () {
        try {
            is();
        } catch (hata) {
            print("trsdizen hata (" + ad + "): " + hata);
        }
    });
    return t;
}

const zamanlayici = tekAtim(BEKLEME, function () { hepsiniDiz(); }, "dizme");
const izleyici = tekAtim(IZLEME, function () { baglilariIzle(); }, "izleme");

// Dizmeyi zamanlar. Daha geç bir dizme zaten bekliyorsa (kapanış beklemesi) onu öne çekmez.
let dizmeZamani = 0;

function planla(ms) {
    const simdi = Date.now();
    const istenen = simdi + (typeof ms === "number" ? ms : BEKLEME);
    if (dizmeZamani > simdi && dizmeZamani >= istenen) {
        zamanlayici.interval = dizmeZamani - simdi;   // bekleyen daha geç: süresi korunur
    } else {
        dizmeZamani = istenen;
        zamanlayici.interval = istenen - simdi;
    }
    zamanlayici.start();
}

function izlePlanla() {
    izleyici.start();
}

// İstekler yanıtlanmış mı diye bir kez daha bakar; her şey yerindeyse hiçbir şey yapmaz.
let dogrulamaBekliyor = false;
const dogrulayici = tekAtim(ISTEK_SURE + 100, function () {
    dogrulamaBekliyor = false;
    if (dizmeZamani > Date.now()) {
        return;                                       // bir dizme zaten bekliyor (kapanış beklemesi): o bakacak
    }
    hepsiniDiz();
}, "doğrulama");

function dogrula() {
    if (!dogrulamaBekliyor) {
        dogrulamaBekliyor = true;
        dogrulayici.start();
    }
}

// ── Yardımcı ve bağlı pencereler ───────────────────────────────────────────────────────────────
function kucukMu(w) {
    if (w.maximizeMode !== 0 || w.fullScreen) {
        return false;
    }
    const a = alan(w);
    const g = w.frameGeometry;
    return g.width > 0 && g.height > 0 && g.width <= a.width * YARDIMCI_EN && g.height <= a.height * YARDIMCI_BOY;
}

// Aynı programın (aynı süreç ya da aynı sınıf) açık ana penceresi; yoksa null
function anaPencere(w) {
    const s = String(w.resourceClass || "").toLowerCase();
    let bulunan = null;
    for (const o of pencereler.values()) {
        if (o === w || !ilgili(o) || o.minimized) {
            continue;
        }
        const od = kayit(o);
        if (od.yardimci) {
            continue;
        }
        const ayniSurec = w.pid > 0 && o.pid === w.pid;
        const ayniSinif = s !== "" && String(o.resourceClass || "").toLowerCase() === s;
        if (!ayniSurec && !ayniSinif) {
            continue;
        }
        const ayniYer = o.output === w.output && o.desktops[0] === w.desktops[0];
        // aynı masaüstündeki tercih edilir; eşitlikte en son açılan
        if (!bulunan || (ayniYer && !bulunan.ayniYer) || (ayniYer === bulunan.ayniYer && od.sira > bulunan.sira)) {
            bulunan = { pencere: o, ayniYer: ayniYer, sira: od.sira };
        }
    }
    return bulunan ? bulunan.pencere : null;
}

// Pencere yardımcı mı? Kararın neye göre verildiği dosyanın başında anlatılıyor.
function yardimciKarari(w) {
    const k = kural(w);
    if (k === "yardimci") {
        return "kural";
    }
    if (!kucukMu(w)) {
        return "";
    }
    if (k === "" || k === "orta") {
        return "oto";
    }
    return anaPencere(w) ? "oto" : "";                // yarı/tam kurallı program: ana penceresi varsa
}

function yardimciKararVer(w, d) {
    const karar = yardimciKarari(w);
    d.yardimci = karar !== "";
    d.yardimciOto = karar === "oto";
    d.yerlesti = false;
    d.ofs = null;
    d.ana = "";
    if (karar) {
        const ana = anaPencere(w);
        d.ana = ana ? kimlik(ana) : "";
    }
}

// Yardımcı sayılan pencere aslında ana pencereymiş: yeni açılmış gibi baştan değerlendirilsin
function anaYap(d) {
    d.yardimci = false;
    d.yardimciOto = false;
    d.ana = "";
    d.ofs = null;
    d.yerlesti = false;
    d.dogum = Date.now();
    istegiUnut(d);
}

// Bağlı ya da yardımcı pencerenin izlediği ana pencere; yoksa null
function ebeveyn(w, d) {
    let p = null;
    if (w.transient) {
        try {
            p = w.transientFor;
        } catch (hata) {
            p = null;
        }
    } else if (d.yardimci && d.ana) {
        p = pencereler.get(d.ana) || null;
    }
    if (!p || p.deleted || p.minimized || p.output !== w.output) {
        return null;
    }
    const ayniMasaustu = !w.desktops || w.desktops.length === 0 || !p.desktops || p.desktops.length === 0
        || p.desktops.indexOf(w.desktops[0]) !== -1;
    if (!ayniMasaustu) {
        return null;
    }
    const pd = durum.get(kimlik(p));
    return pd && !pd.haric ? p : null;
}

// Bağlı pencerenin ana pencereye göre yerini öğren. Pencere AÇILDIĞI ANDA çağrılmalı: az sonra ana
// pencere taşınırsa aradaki uzaklık yanlış öğrenilir.
function ofsOgren(w, d) {
    const p = ebeveyn(w, d);
    if (!p) {
        return false;
    }
    const g = w.frameGeometry;
    const a = alan(w);
    const m = merkez(g);
    const pm = merkez(p.frameGeometry);
    // KWin kutuyu ana pencerenin ortasına koyar; sığmıyorsa ekran kenarına dayar. O kaydırma kutunun
    // "yeri" değildir: asıl niyet ortadır, ana pencere genişleyince kutu yine ortaya gelmeli.
    d.ofs = {
        x: kenaraDayandi(g.x, g.width, pm.x, a.x, a.width) ? 0 : m.x - pm.x,
        y: kenaraDayandi(g.y, g.height, pm.y, a.y, a.height) ? 0 : m.y - pm.y
    };
    return true;
}

// Ortalanınca alandan taşacak olan ve şu an alanın kenarına dayalı duran pencere (tek eksende)
function kenaraDayandi(konum, boy, anaMerkez, alanBasi, alanBoyu) {
    const ortada = anaMerkez - boy / 2;
    const tasar = ortada < alanBasi - TOLERANS || ortada + boy > alanBasi + alanBoyu + TOLERANS;
    const dayali = Math.abs(konum - alanBasi) <= TOLERANS || Math.abs(konum + boy - alanBasi - alanBoyu) <= TOLERANS;
    return tasar && dayali;
}

// Pencereyi, merkezi verilen noktaya gelecek şekilde (boyutuna dokunmadan, ekrandan taşırmadan) koyar
function merkezeKoy(w, d, m, ad) {
    const a = alan(w);
    const g = w.frameGeometry;
    let x = Math.round(m.x - g.width / 2);
    let y = Math.round(m.y - g.height / 2);
    if (Math.abs(g.x - x) <= TOLERANS && Math.abs(g.y - y) <= TOLERANS && Date.now() - d.istekZamani >= ISTEK_SURE) {
        return g;                                     // zaten orada (ekrandan taşıyor olsa bile): dokunma
    }
    x = Math.max(a.x, Math.min(x, a.x + a.width - g.width));
    y = Math.max(a.y, Math.min(y, a.y + a.height - g.height));
    const hedef = { x: x, y: y, width: g.width, height: g.height };
    yereKoy(w, d, hedef, ad + ":" + anahtar(hedef));
    return hedef;
}

// Yardımcılar: büyük açıldıysa küçült, ana penceresi yoksa ekranın ortasına bir kez koy
function yardimcilariYerlestir() {
    for (const w of pencereler.values()) {
        const d = durum.get(kimlik(w));
        if (!d || !d.yardimci || d.yerlesti || d.elle || d.tasiniyor || !ilgili(w) || w.minimized || w.fullScreen) {
            continue;
        }
        if (w.maximizeMode !== 0) {
            // Büyütülmüş açıldı (program eski hâlini hatırlamış): önce küçült. Gerçek boyutu pencere
            // yanıt verince belli olur; o zaman (maximizedChanged) buraya yeniden gelinir.
            istekYap(w, d, "kucuk", false, function () { w.setMaximize(false, false); });
            continue;
        }
        if (ebeveyn(w, d)) {
            d.ofs = { x: 0, y: 0 };                   // ana pencerenin tam ortası; izleme geçişi taşır
            d.yerlesti = true;
            continue;
        }
        const a = alan(w);
        const hedef = merkezeKoy(w, d, merkez(a), "yardimci");
        if (yakin(w.frameGeometry, hedef) || d.deneme >= DENEME) {
            d.yerlesti = true;
        }
    }
}

// "orta" kurallı pencere yalnızca açılış süresince korunur: program o arada kendini büyütür ya da
// taşırsa yeniden ortalanır. Süre dolunca bir daha dokunulmaz.
function ortalariKoru() {
    const simdi = Date.now();
    for (const w of pencereler.values()) {
        const d = durum.get(kimlik(w));
        if (!d || d.elle || d.yardimci || d.tasiniyor || simdi - d.dogum > DOGUM_SURE + ISTEK_SURE) {
            continue;
        }
        if (!ilgili(w) || w.minimized || w.fullScreen || kural(w) !== "orta") {
            continue;
        }
        ortaYap(w, d);
    }
}

// Bağlı ve yardımcı pencereler ana pencereyi izler: ana pencerenin GERÇEK yeri değiştikçe aynı
// uzaklıkta durur. Ayrıca kendiliğinden büyüyen yardımcıyı ana pencereye çevirir.
function baglilariIzle() {
    let yenidenDiz = dosenenleriIsaretle();           // az önce kenara yaslanan pencere geri çekilmesin
    for (const w of pencereler.values()) {
        const d = durum.get(kimlik(w));
        if (!d || w.deleted || d.elle || d.tasiniyor || w.minimized || w.fullScreen) {
            continue;
        }
        const yardimci = d.yardimci && ilgili(w);
        if (yardimci && d.yardimciOto && w.maximizeMode === 0 && !kucukMu(w)) {
            anaYap(d);                                // küçük açılıp sonradan büyüdü: yardımcı değil
            yenidenDiz = true;
            continue;
        }
        if (w.maximizeMode !== 0 || w.moveable === false || !(yardimci || bagliCocuk(w))) {
            continue;
        }
        const p = ebeveyn(w, d);
        if (!p) {
            continue;
        }
        if (!d.ofs) {
            ofsOgren(w, d);                           // ana pencere yeni uygun oldu: yerini şimdi öğren
            continue;
        }
        const pm = merkez(p.frameGeometry);
        merkezeKoy(w, d, { x: pm.x + d.ofs.x, y: pm.y + d.ofs.y }, "bagli");
    }
    if (yenidenDiz) {
        planla();
    }
}

function ozelGecis() {
    try {
        yardimcilariYerlestir();
        ortalariKoru();
        baglilariIzle();
    } catch (hata) {
        print("trsdizen hata (yardımcı): " + hata);
    }
}

// ── Yerleşim hesabı ────────────────────────────────────────────────────────────────────────────
// liste: aynı masaüstü + ekrandaki sayılan pencereler (açılış sırasıyla).
// Döndürür: Map(pencere → "tam" | "sol" | "sag" | ""); dokunulmayanlar için kapladıkları yarı.
function hesapla(liste) {
    const n = liste.length;
    const yer = new Map();
    const sabit = new Set();

    // 1. Dokunulmayanlar ve kuralı olanlar
    for (const w of liste) {
        const d = kayit(w);
        const k = kural(w);
        if (d.tasiniyor) {
            sabit.add(w);
            yer.set(w, d.yer);                        // sürükleniyor: bırakılana kadar eski yerinde say
        } else if (d.elle || w.fullScreen) {
            sabit.add(w);
            d.yer = kapladigiYari(w);
            yer.set(w, d.yer);
        } else if (k === "tam") {
            yer.set(w, "tam");
        } else if (k === "sag-hep" || k === "sol-hep") {
            yer.set(w, k.substring(0, 3));
        } else if (k === "sag" || k === "sol") {
            yer.set(w, n === 1 ? "tam" : k);
        }
    }

    // 2. Kuralsızlar
    for (const w of liste) {
        if (yer.has(w)) {
            continue;
        }
        const d = kayit(w);
        if (n === 1) {
            d.taraf = "";
            yer.set(w, "tam");
        } else if (n === 2) {
            const diger = liste[0] === w ? liste[1] : liste[0];
            let digerYer = yer.has(diger) ? yer.get(diger) : kayit(diger).taraf;
            if (digerYer !== "sol" && digerYer !== "sag") {
                digerYer = "";
            }
            if (digerYer && !yer.has(diger) && digerYer === d.taraf) {
                // ikisi de aynı yarıdaydı (üçüncü pencere kapandı) ve ikisi de oynatılabilir:
                // önce açılan sola, sonraki sağa
                d.taraf = liste[0] === w ? "sol" : "sag";
            } else if (digerYer) {
                d.taraf = karsi(digerYer);            // öbürünün karşısına
            } else if (d.taraf !== "sol" && d.taraf !== "sag") {
                d.taraf = liste[0] === w ? "sol" : "sag";   // önce açılan sola
            }
            yer.set(w, d.taraf);
        } else {
            if (d.taraf !== "sol" && d.taraf !== "sag") {
                d.taraf = Math.random() < 0.5 ? "sol" : "sag";
            }
            yer.set(w, d.taraf);
        }
    }

    // 3. Çakışma: yarım pencerelerin hepsi bir yarıda, öbürü boşsa en az üstün olan karşıya geçer.
    //    (Tam ekran pencereler yarı kaplamaz; dokunulmayanlar yerinden oynatılamaz.)
    const sayi = { sol: 0, sag: 0 };
    for (const w of liste) {
        const y = yer.get(w);
        if (y === "sol" || y === "sag") {
            sayi[y]++;
        }
    }
    const dolu = sayi.sol === 0 && sayi.sag >= 2 ? "sag" : (sayi.sag === 0 && sayi.sol >= 2 ? "sol" : "");
    if (dolu) {
        let aday = null;
        for (const w of liste) {
            if (yer.get(w) !== dolu || sabit.has(w)) {
                continue;
            }
            if (!aday || ustunluk(w) > ustunluk(aday)
                || (ustunluk(w) === ustunluk(aday) && kayit(w).sira > kayit(aday).sira)) {
                aday = w;
            }
        }
        if (aday) {
            yer.set(aday, karsi(dolu));
            if (kuralNo(aday) === -1) {
                kayit(aday).taraf = karsi(dolu);
            }
        }
    }
    return { yer: yer, sabit: sabit };
}

// Sayılan pencere mi? (yerleşim hesabına girer)
function sayilir(w) {
    if (!ilgili(w) || w.minimized) {
        return false;
    }
    return kural(w) !== "orta" && !kayit(w).yardimci;
}

// Açık pencereleri masaüstü + ekran (+ etkinlik) öbeklerine böler
function grupla() {
    const gruplar = new Map();
    const etkinlik = cokEtkinlik();
    for (const w of pencereler.values()) {
        const say = sayilir(w);
        kayit(w).sayildi = say;
        if (!say) {
            kayit(w).sonGrupBoyu = 0;
            continue;
        }
        const k = workspace.screens.indexOf(w.output) + ":" + workspace.desktops.indexOf(w.desktops[0])
            + (etkinlik ? ":" + w.activities[0] : "");
        if (!gruplar.has(k)) {
            gruplar.set(k, []);
        }
        gruplar.get(k).push(w);
    }
    for (const liste of gruplar.values()) {
        liste.sort(function (a, b) { return kayit(a).sira - kayit(b).sira; });
    }
    return gruplar;
}

// Yalnızken tam duran elle pencereye yanına sayılan yeni pencere geldi: elle sayılmaktan çıkar,
// ikisi kurala göre bölünür (kullanıcı kararı 2026-10-21). Başka pencereler varken büyütülene dokunulmaz.
function yalnizTamiCoz(liste) {
    if (liste.length < 2) {
        return;
    }
    for (const w of liste) {
        const d = kayit(w);
        if (d.elle && d.sonGrupBoyu === 1 && !d.tasiniyor && !w.fullScreen && !dosendiMi(w)
            && durduguYer(w) === "tam") {
            d.elle = false;
            d.yalnizdanCozuldu = true;                // sınama ve rapor için iz
        }
    }
}

function uygula(liste) {
    yalnizTamiCoz(liste);
    for (const w of liste) {
        kayit(w).sonGrupBoyu = liste.length;
    }
    const sonuc = hesapla(liste);
    for (const w of liste) {
        const d = kayit(w);
        if (sonuc.sabit.has(w)) {
            continue;
        }
        const y = sonuc.yer.get(w);
        const a = alan(w);
        d.yer = y;
        if (y === "tam") {
            tamYap(w, d);
        } else if (y === "sol" || y === "sag") {
            const hedef = yariDikdortgen(a, y);
            yereKoy(w, d, hedef, y + ":" + anahtar(hedef));
        }
    }
}

// Döşeme sinyali gecikmeli gelir; o gelmeden dizmeye kalkarsak kullanıcının az önce kenara yasladığı
// pencereyi geri çekeriz. Betik hiç döşemediği için döşenmiş her pencere elle yerleştirilmiştir.
function dosenenleriIsaretle() {
    let yeni = false;
    for (const w of pencereler.values()) {
        const d = durum.get(kimlik(w));
        if (d && !d.elle && !d.tasiniyor && dosendiMi(w)) {
            d.elle = true;
            yeni = true;
        }
    }
    return yeni;
}

// Kapandığı bize bildirilmemiş pencereleri ayıkla. Yok edilmiş bir pencerenin özelliğine dokunmak
// hata verir; ayıklanmazsa o tek pencere bütün dizmeyi durdururdu.
function olenleriAyikla() {
    for (const k of Array.from(pencereler.keys())) {
        let olu = false;
        try {
            const w = pencereler.get(k);
            olu = !w || w.deleted === true || w.internalId === undefined;
        } catch (hata) {
            olu = true;
        }
        if (olu) {
            pencereler.delete(k);
            durum.delete(k);
        }
    }
}

function hepsiniDiz() {
    sayaclar.diz++;
    dizmeZamani = 0;
    olenleriAyikla();
    let gruplar;
    try {
        dosenenleriIsaretle();
        gruplar = grupla();
    } catch (hata) {
        print("trsdizen hata (gruplama): " + hata);
        return;
    }
    for (const liste of gruplar.values()) {
        try {
            uygula(liste);                            // bir gruptaki hata öbür masaüstlerini etkilemesin
        } catch (hata) {
            print("trsdizen hata (yerleşim): " + hata);
        }
    }
    ozelGecis();
}

// ── Elle müdahale ──────────────────────────────────────────────────────────────────────────────
function elleYap(d) {
    d.elle = true;
    planla();                                         // öbürleri bu pencereye göre yeniden yerleşsin
    izlePlanla();
}

// Büyütme / küçültme isteği (istek ANINDA, eşzamanlı gelir). Kullanıcı mı yaptı, biz mi, program mı?
function buyutmeIstendi(w) {
    if (kendiCagri > 0) {
        return;                                       // biz yapıyoruz
    }
    const d = durum.get(kimlik(w));
    if (!d || d.tasiniyor) {
        return;                                       // sürüklerken üst kenara bırakma: bitince elle sayılır
    }
    if (!ilgili(w)) {
        if (bagliCocuk(w)) {
            d.elle = true;                            // bağlı pencere büyütüldü: artık izlemesin
        }
        return;
    }
    if (Date.now() - d.dogum < DOGUM_SURE && d.dogumBuyutme < DOGUM_BUYUTME) {
        // Program açılırken eski hâlini geri yüklüyor: elle sayma, kuralı yeniden uygula. Önceki
        // isteğimiz artık geçersiz (pencere başka yere gidiyor): unutulsun ki yeniden istensin.
        d.dogumBuyutme++;
        if (d.yardimci && d.yardimciOto) {
            anaYap(d);                                // küçük açılıp kendini büyüten: ana pencere
        }
        d.yerlesti = false;
        istegiUnut(d);
        planla();
        dogrula();
        return;
    }
    elleYap(d);
}

// Döşeme (kenara yaslama) değişti. Sinyal, pencere yanıt verince GECİKMELİ gelir; o yüzden süreye
// değil sonuca bakılır: pencere bir döşemeye girdiyse bunu kullanıcı yapmıştır.
function doseDegisti(w) {
    if (kendiCagri > 0) {
        return;
    }
    const d = durum.get(kimlik(w));
    if (!d || d.tasiniyor) {
        return;
    }
    if (dosendiMi(w)) {
        elleYap(d);                                   // zaten elle olsa da yeri değişti: öbürleri yeniden dizilsin
    }
}

function tasimaBasladi(w) {
    const d = durum.get(kimlik(w));
    if (!d) {
        return;
    }
    const g = w.frameGeometry;
    d.tasiniyor = true;
    d.tasimaOynadi = false;
    d.tasimaBasi = { x: g.x, y: g.y, width: g.width, height: g.height };
}

// Sürükleme adımı: g, kullanıcının İSTEDİĞİ dikdörtgendir (pencere henüz oraya gelmemiş olabilir)
function tasimaAdimi(w, g) {
    const d = durum.get(kimlik(w));
    if (d && d.tasimaBasi && g && typeof g.width === "number" && !yakin(d.tasimaBasi, g)) {
        d.tasimaOynadi = true;
    }
}

function tasimaBitti(w) {
    const d = durum.get(kimlik(w));
    if (!d) {
        return;
    }
    const once = d.tasimaBasi;
    const oynadi = d.tasimaOynadi || !once || !yakin(once, w.frameGeometry);
    d.tasiniyor = false;
    d.tasimaBasi = null;
    d.tasimaOynadi = false;
    if (w.deleted) {
        return;
    }
    if (oynadi && (ilgili(w) || bagliCocuk(w))) {
        elleYap(d);
        return;
    }
    planla();                                         // tutup bıraktı ama oynatmadı: bekleyen iş varsa yapılsın
    izlePlanla();
}

// Programın kimliği sonradan belli oldu ya da kurallar değişti: bu pencerenin kuralı değişti mi?
// Değiştiyse pencere yeni açılmış gibi yeniden değerlendirilir. Değişmediyse hiçbir şeye dokunulmaz.
function kuralDegisimi(w) {
    const d = durum.get(kimlik(w));
    if (!d) {
        return false;
    }
    const il = ilgili(w);
    siniflandir(w, d);
    const ozet = d.haric ? "haric" : (d.kuralNo === -1 ? "" : KURALLAR[d.kuralNo].ozet);
    if (ozet === d.sonKural) {
        return false;
    }
    const ilk = d.sonKural === null;
    d.sonKural = ozet;
    if (ilk || d.elle || !il) {
        return !ilk;
    }
    d.dogum = Date.now();
    d.dogumBuyutme = 0;
    istegiUnut(d);
    yardimciKararVer(w, d);
    return true;
}

// Pencere sonradan bir ana pencereye bağlandı (ya da bağı koptu)
function baglantiDegisti(w) {
    const d = durum.get(kimlik(w));
    if (d && !d.elle) {
        d.ofs = null;
        if (bagliCocuk(w)) {
            ofsOgren(w, d);
        } else if (ilgili(w)) {
            // Bağı koptu (ana penceresi kapandı): küçük bir kutuysa yarıya gerilmesin, olduğu yerde kalsın
            yardimciKararVer(w, d);
            d.yerlesti = true;
        }
    }
    planla();
}

function sinifDegisti(w) {
    if (kuralDegisimi(w)) {
        ozelGecis();
    }
    planla();
}

// ── Olaylar ────────────────────────────────────────────────────────────────────────────────────
function bagla(w) {
    if (!w || !(w.normalWindow || w.dialog) || w.popupWindow) {
        return false;                                 // ipucu, menü, açılır pencere: hiç ilgilenme
    }
    const k = kimlik(w);
    if (pencereler.has(k)) {
        return true;
    }
    pencereler.set(k, w);
    kayit(w);
    const sinyaller = [
        ["interactiveMoveResizeStarted", function () { tasimaBasladi(w); }],
        ["interactiveMoveResizeStepped", function (g) { tasimaAdimi(w, g); }],
        ["interactiveMoveResizeFinished", function () { tasimaBitti(w); }],
        ["maximizedAboutToChange", function () { buyutmeIstendi(w); }],
        ["quickTileModeChanged", function () { doseDegisti(w); }],
        ["tileChanged", function () { doseDegisti(w); }],
        // büyütme GERÇEKLEŞİNCE (pencere yanıt verince) öbürlerini güncel duruma göre yeniden değerlendir
        ["maximizedChanged", function () { planla(); }],
        ["minimizedChanged", function () { planla(); }],
        ["desktopsChanged", function () { planla(); }],
        ["activitiesChanged", function () { planla(); }],
        ["outputChanged", function () { planla(); }],
        ["fullScreenChanged", function () { planla(); }],
        ["keepAboveChanged", function () { planla(); }],
        ["skipTaskbarChanged", function () { planla(); }],
        ["transientChanged", function () { baglantiDegisti(w); }],
        ["windowClassChanged", function () { sinifDegisti(w); }],
        ["desktopFileNameChanged", function () { sinifDegisti(w); }],
        ["frameGeometryChanged", izlePlanla]
    ];
    for (const s of sinyaller) {
        try {
            w[s[0]].connect(korumali(s[1], s[0]));
        } catch (hata) {
            // bu KWin sürümünde o sinyal yok: ötekiler yine bağlanır
        }
    }
    return true;
}

function korumali(is, ad) {
    return function () {
        try {
            is.apply(null, arguments);
        } catch (hata) {
            print("trsdizen hata (" + ad + "): " + hata);
        }
    };
}

// Yeni açılan pencere
function pencereEklendi(w) {
    if (!bagla(w)) {
        return;
    }
    const d = kayit(w);
    kuralDegisimi(w);                                 // ilk kural özetini kaydeder
    if (!ilgili(w)) {
        if (bagliCocuk(w)) {
            ofsOgren(w, d);
        }
        return;
    }
    yardimciKararVer(w, d);
    if (hatiradanKoy(w, d)) {
        planla();                                     // öbürleri bu pencereye göre yerleşsin
        return;
    }
    ozelGecis();                                      // yardımcı ve "orta" pencere beklemeden yerine konur
    planla();
}

function pencereKaldirildi(w) {
    const k = kimlik(w);
    pencereler.delete(k);
    const d = durum.get(k);
    if (!d) {
        return;
    }
    hatirla(w, d);
    durum.delete(k);
    if (yardimcilariDevret(k) || d.sayildi) {
        planla(KAPANIS_BEKLEME);                      // yer açıldı: kalanlar yeniden dizilsin
    }
    // sayılmayan pencere (iletişim kutusu, yardımcı, "orta", simge durumundaki) kapandı: kimse oynamaz
}

// ── Devir: betik yeniden yüklenirken durum eskisinden yenisine geçer ───────────────────────────
// Biçim: "zaman|kimlik,elle,taraf,yardimci,ana,sira,yer;..."  (yardimci: 0 yok, k kuralla, o boyutla)
// zaman: devrin alındığı an (ms). Eski bir devir (betik başka yoldan yeniden yüklendiyse) kullanılmaz.
const DEVIR_OMRU = 13000;
function devirMetni() {
    const parcalar = [];
    for (const k of pencereler.keys()) {
        const d = durum.get(k);
        if (d) {
            parcalar.push([k, d.elle ? 1 : 0, d.taraf, d.yardimci ? (d.yardimciOto ? "o" : "k") : 0, d.ana, d.sira, d.yer].join(","));
        }
    }
    return parcalar.join(";");
}

function devirOku() {
    const m = new Map();
    const ham = ayarOku("Devir");
    const ayrac = ham.indexOf("|");
    const yas = Date.now() - Number(ham.substring(0, ayrac));
    if (ayrac === -1 || !(yas >= -DEVIR_OMRU && yas <= DEVIR_OMRU)) {
        return m;
    }
    for (const parca of ham.substring(ayrac + 1).split(";")) {
        const a = parca.split(",");
        if (a.length >= 7 && a[0]) {
            m.set(a[0], { elle: a[1] === "1", taraf: a[2], yardimci: a[3], ana: a[4], sira: Number(a[5]) || 0, yer: a[6] });
        }
    }
    return m;
}

// Ana pencere kapandı; ona bağlı sayılan yardımcılar ne olacak?
//   aynı programın başka ana penceresi varsa   ona bağlanır, onun ortasına geçer
//   yoksa ve program yarı/tam kurallıysa       artık programın tek penceresidir: olağan pencere olur
//   kuralsız / "orta" programın yardımcısı     yardımcı kalır
// Olağan pencereye çevrilen olduysa true döner.
function yardimcilariDevret(kapanan) {
    let cevrildi = false;
    for (const w of pencereler.values()) {
        const d = durum.get(kimlik(w));
        if (!d || !d.yardimci || d.ana !== kapanan) {
            continue;
        }
        d.ana = "";
        d.ofs = null;
        if (!ilgili(w)) {
            continue;
        }
        const yeniAna = anaPencere(w);
        if (yeniAna) {
            d.ana = kimlik(yeniAna);
            if (!d.elle) {
                d.ofs = { x: 0, y: 0 };               // kalan ana pencerenin ortasına geçer
                izlePlanla();
            }
            continue;
        }
        const k = kural(w);
        if (d.yardimciOto && !d.elle && k !== "" && k !== "orta" && k !== "yardimci") {
            anaYap(d);
            cevrildi = true;
        }
    }
    return cevrildi;
}

// Betik yüklendiğinde açık olan pencereleri olduğu gibi devral: hiçbir şeyi yerinden oynatma.
function devral() {
    const devir = devirOku();
    for (const v of devir.values()) {
        sayac = Math.max(sayac, v.sira + 1);          // devralınmayan pencereler sıraya sonradan girsin
    }
    const bilinmeyen = new Set();
    for (const w of workspace.windowList()) {
        if (!bagla(w)) {
            continue;
        }
        const d = kayit(w);
        d.dogum = 0;                                  // açılış süresi çoktan geçti
        d.yerlesti = true;                            // yardımcılar yeniden ortalanmaz
        kuralDegisimi(w);
        const v = devir.get(kimlik(w));
        if (v) {
            d.elle = v.elle;
            d.taraf = v.taraf === "sol" || v.taraf === "sag" ? v.taraf : "";
            d.yardimci = v.yardimci === "k" || v.yardimci === "o";
            d.yardimciOto = v.yardimci === "o";
            d.ana = v.ana;
            d.sira = v.sira;
            d.yer = v.yer;
            continue;                                 // devir tazedir: olduğu gibi güvenilir
        }
        if (!ilgili(w)) {
            continue;
        }
        bilinmeyen.add(w);
        const karar = yardimciKarari(w);
        if (karar) {
            const ana = anaPencere(w);
            d.yardimci = true;
            d.yardimciOto = karar === "oto";
            d.ana = ana ? kimlik(ana) : "";
        } else if (kural(w) !== "orta" && kuralNo(w) === -1) {
            const y = durduguYer(w);
            if (y === "sol" || y === "sag") {
                d.taraf = y;                          // kuralsız pencerenin yarısını durduğu yerden öğren
            }
        }
    }
    for (const w of pencereler.values()) {
        const d = kayit(w);
        if (!d.elle && (bagliCocuk(w) || (d.yardimci && ilgili(w)))) {
            ofsOgren(w, d);                           // oldukları yerde kalsınlar, sonra ana pencereyi izlesinler
        }
    }
    // Durumu devredilmemiş pencereler: kurala göre olması gereken yerde durmayan her biri elle
    // yerleştirilmiş sayılır. Her yeni elle işareti hesabı değiştirir; değişmeyene kadar yinelenir
    // ki ilk dizmede hiçbir pencere yerinden oynamasın.
    for (let tur = 0; tur <= bilinmeyen.size; tur++) {
        let degisti = false;
        for (const liste of grupla().values()) {
            const sonuc = hesapla(liste);
            for (const w of liste) {
                if (!bilinmeyen.has(w) || sonuc.sabit.has(w)) {
                    continue;
                }
                const d = kayit(w);
                const y = sonuc.yer.get(w);
                if (durduguYer(w) !== y) {
                    d.elle = true;
                    degisti = true;
                } else {
                    d.yer = y;
                }
            }
        }
        if (!degisti) {
            break;
        }
    }
}

// Bütün elle işaretlerini sil ve baştan diz ("trs-dizen sifirla")
function sifirla() {
    hatira.clear();
    for (const w of pencereler.values()) {
        degistir(function () { doseyiBirak(w); });    // döşemede kalan pencere yeniden elle sayılırdı
    }
    sayaclar.islem -= pencereler.size;
    for (const d of durum.values()) {
        d.elle = false;
        d.taraf = "";
        d.ofs = null;
        d.deneme = 0;
        istegiUnut(d);
    }
    planla();
    izlePlanla();
}

// ── Durum raporu ("trs-dizen durum") ───────────────────────────────────────────────────────────
function disariYaz(metin) {
    callDBus("org.freedesktop.DBus", "/", "org.freedesktop.DBus", "GetNameOwner", metin);
}

function rapor() {
    let m = "TRSDIZEN surum=3 kural=" + KURALLAR.length + " haric=" + HARIC.length
        + " diz=" + sayaclar.diz + " islem=" + sayaclar.islem;
    for (const w of workspace.windowList()) {
        if (!(w.normalWindow || w.dialog) || w.popupWindow) {
            continue;
        }
        const d = durum.get(kimlik(w));
        const n = neden(w);
        const il = n === "";
        const bagli = !il && bagliCocuk(w);
        m += " | " + (w.resourceClass || "?")
            + " ilgili=" + (il ? "evet" : "HAYIR(" + n + (bagli ? ",izliyor" : "") + ")")
            + " kural=" + (il ? (kural(w) || "yok") : "-")
            + " elle=" + (d && d.elle ? "EVET" : "hayir")
            + " taraf=" + (d && d.taraf ? d.taraf : "-")
            + " yardimci=" + (d && d.yardimci ? (d.yardimciOto ? "EVET(boyut)" : "EVET(kural)") : "hayir")
            + " durum=" + (w.minimized ? "kucultulmus" : w.fullScreen ? "tam-ekran" : (il ? (durduguYer(w) || "serbest") : "-"))
            + " masaustu=" + (w.desktops && w.desktops.length ? workspace.desktops.indexOf(w.desktops[0]) + 1 : 0);
    }
    disariYaz(m);
}

// kwinrc değişti (trs-dizen yazıp KWin'e yeniden okuttu): kurallar, sıfırlama, rapor ya da devir isteği
const sonIstek = {};

function istekGeldi(ad) {
    const deger = ayarOku(ad);
    if (deger === sonIstek[ad]) {
        return false;
    }
    sonIstek[ad] = deger;
    return true;
}

function ayarDegisti() {
    kararlariOku();
    if (kurallariYukle()) {
        let degisen = false;
        for (const w of Array.from(pencereler.values())) {
            degisen = (KURAL_HEMEN && kuralDegisimi(w)) || degisen;
        }
        if (degisen) {
            ozelGecis();
        }
        planla();
    }
    if (istekGeldi("SifirlaIste")) {
        sifirla();
    }
    if (istekGeldi("RaporIste")) {
        rapor();
    }
    if (istekGeldi("DevirIste")) {
        disariYaz("TRSDIZEN-DEVIR " + Date.now() + "|" + devirMetni());
    }
}

// ── Başlangıç ──────────────────────────────────────────────────────────────────────────────────
kurallariYukle();
for (const ad of ["SifirlaIste", "RaporIste", "DevirIste"]) {
    sonIstek[ad] = ayarOku(ad);
}

workspace.windowAdded.connect(korumali(pencereEklendi, "eklendi"));
workspace.windowRemoved.connect(korumali(pencereKaldirildi, "kaldırıldı"));
for (const ad of ["screensChanged", "desktopsChanged", "virtualScreenSizeChanged", "activitiesChanged", "currentActivityChanged"]) {
    try {
        workspace[ad].connect(function () { planla(); });
    } catch (hata) {
        // bu sürümde yok
    }
}
kararlariOku();
options.configChanged.connect(korumali(ayarDegisti, "ayar"));

try {
    devral();
} catch (hata) {
    print("trsdizen hata (devralma): " + hata);
}
planla();

// Sınama düzeneği iç durumu görebilsin (KWin'de bu işlev tanımlı değildir)
if (typeof trsSinamaKancasi === "function") {
    trsSinamaKancasi({
        durum: durum, kayit: kayit, sayaclar: sayaclar, hepsiniDiz: hepsiniDiz, ilgili: ilgili, kural: kural,
        neden: neden, kurallar: function () { return KURALLAR; }
    });
}
