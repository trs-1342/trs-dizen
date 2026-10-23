#!/usr/bin/env node
/*
    TRS Dizen sınama düzeneği:  node sina.js [--ayrinti] [--tohum N]

    contents/code/main.js dosyasını, KWin'in yerini tutan sahte bir pencere yöneticisinde çalıştırır.
    Gerçek masaüstüne dokunmaz. Üç bölüm:
      1. Senaryolar   "şu olursa ne olur" tek tek, beklenen sonuçla
      2. Rastgele     binlerce rastgele olay dizisi; her adımda değişmezler denetlenir
      3. Canlı kurallar  ~/.config/trs/dizen-kurallar.json: her program gerçekten istenen yere gidiyor mu
    Sahte ortam zamanı kendisi ilerletir (bekleme yok) ve pencerelerin isteklere GECİKMELİ yanıt
    vermesini de taklit edebilir.
*/
const vm = require("vm");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const BETIK = process.env.TRS_DIZEN_BETIK || path.join(__dirname, "contents/code/main.js");   // olumsuz sınama için değiştirilebilir
const KOD = fs.readFileSync(BETIK, "utf8");
const AYRINTI = process.argv.includes("--ayrinti");
const TOHUM = process.argv.includes("--tohum") ? Number(process.argv[process.argv.indexOf("--tohum") + 1]) : 1342;

// ── Sahte ortam ────────────────────────────────────────────────────────────────────────────────
class Sinyal {
    constructor() { this.a = []; }
    connect(f) { this.a.push(f); }
    emit() { for (const f of this.a.slice()) { f.apply(null, arguments); } }
}

const PENCERE_SINYALLERI = ["interactiveMoveResizeStarted", "interactiveMoveResizeStepped", "interactiveMoveResizeFinished",
    "maximizedAboutToChange", "maximizedChanged", "quickTileModeChanged", "tileChanged", "minimizedChanged", "desktopsChanged",
    "activitiesChanged", "outputChanged", "fullScreenChanged", "keepAboveChanged", "skipTaskbarChanged", "transientChanged",
    "windowClassChanged", "desktopFileNameChanged", "frameGeometryChanged"];

function rastgeleUret(tohum) {                         // mulberry32: tohumdan yinelenebilir sayılar
    let a = tohum >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const TEST_KURALLARI = {
    k: [["firefox", "sag"], ["konsole", "sol"], ["sublime", "sag-hep"], ["jetbrains-studio", "tam"],
        ["discord", "orta"], ["eclipse", "orta", 0.80, 0.90], ["kate", "sol"], ["okular", "sag"], ["zeal", "sag"],
        ["org.freedesktop.impl.portal", "yardimci"], ["yalnizsinamada", "tam"]],
    h: ["net.trs.pano", "plasmashell", "vlc"]
};

class Ortam {
    constructor(secenek) {
        secenek = secenek || {};
        this.simdi = 1000000;
        this.isler = [];
        this.isNo = 0;
        this.pencereler = [];
        this.pencereNo = 0;
        this.cikti = [];
        this.dbus = [];
        this.ayar = { Kurallar: JSON.stringify(secenek.kurallar || TEST_KURALLARI) };
        this.rastgele = rastgeleUret(secenek.tohum || TOHUM);
        this.gecikme = secenek.gecikme || 0;            // pencerelerin isteklere yanıt gecikmesi (ms)
        this.ekranlar = [];
        for (let i = 0; i < (secenek.ekran || 1); i++) {
            this.ekranlar.push({ ad: "ekran" + i, alan: { x: i * 1920, y: 0, width: 1920, height: 1080 } });
        }
        this.masaustleri = [];
        for (let i = 0; i < 9; i++) { this.masaustleri.push({ ad: "m" + (i + 1) }); }
        this.etkinlikler = secenek.etkinlikler || ["ana"];
        const o = this;
        this.workspace = {
            get screens() { return o.ekranlar.slice(); },
            get desktops() { return o.masaustleri.slice(); },
            get activities() { return o.etkinlikler.slice(); },
            currentActivity: this.etkinlikler[0],
            activitiesChanged: new Sinyal(), currentActivityChanged: new Sinyal(),
            currentDesktop: this.masaustleri[0],
            activeScreen: this.ekranlar[0],
            windowList() { return o.pencereler.slice(); },
            clientArea(tur, ekran, masaustu) { const a = ekran.alan; return { x: a.x, y: a.y, width: a.width, height: a.height }; },
            windowAdded: new Sinyal(), windowRemoved: new Sinyal(),
            screensChanged: new Sinyal(), desktopsChanged: new Sinyal(), virtualScreenSizeChanged: new Sinyal()
        };
        this.options = { configChanged: new Sinyal() };
        this.ic = null;
        this.betikYukle();
    }

    // zaman
    zamanla(ms, is) { const id = ++this.isNo; this.isler.push({ zaman: this.simdi + ms, id: id, is: is }); return id; }
    iptal(id) { this.isler = this.isler.filter(function (i) { return i.id !== id; }); }
    ilerle(ms) {
        const hedef = this.simdi + ms;
        for (;;) {
            let en = null;
            for (const i of this.isler) { if (i.zaman <= hedef && (!en || i.zaman < en.zaman || (i.zaman === en.zaman && i.id < en.id))) { en = i; } }
            if (!en) { break; }
            this.iptal(en.id);
            this.simdi = en.zaman;
            en.is();
        }
        this.simdi = hedef;
    }
    otur() { this.ilerle(3000); }                       // her şey yerine otursun

    // betiği (yeniden) yükle: eski örneğin bağlantıları ve zamanlayıcıları silinir.
    // devret: "trs-dizen kur" gibi önce çalışan betikten durumunu ister ve yenisine aktarır
    betikYukle(devret, eskiDevirKalsin) {
        if (!devret && !eskiDevirKalsin) { this.ayar.Devir = ""; }      // araç, devri kullandıktan sonra siler
        if (devret) {
            this.ayarDegistir("DevirIste", "d" + (++this.isNo));
            const yanit = this.dbus.map(function (c) { return String(c[4]); }).filter(function (m) { return m.indexOf("TRSDIZEN-DEVIR ") === 0; }).pop();
            if (yanit === undefined) { throw new Error("betik devir isteğine yanıt vermedi"); }
            this.ayar.Devir = yanit.substring("TRSDIZEN-DEVIR ".length);
        }
        for (const s of Object.values(this.workspace)) { if (s instanceof Sinyal) { s.a = []; } }
        this.options.configChanged.a = [];
        for (const w of this.pencereler) { for (const ad of PENCERE_SINYALLERI) { w[ad].a = []; } }
        this.isler = this.isler.filter(function (i) { return i.pencereIsi; });
        const o = this;
        class QTimer {
            constructor() { this.singleShot = false; this.interval = 0; this.timeout = new Sinyal(); this._id = null; }
            start() {
                this.stop();
                const t = this;
                const kur = function () {
                    t._id = o.zamanla(t.interval, function () { t._id = null; if (!t.singleShot) { kur(); } t.timeout.emit(); });
                };
                kur();
            }
            stop() { if (this._id !== null) { o.iptal(this._id); this._id = null; } }
        }
        const baglam = {
            workspace: this.workspace, options: this.options, KWin: { MaximizeArea: 2 }, QTimer: QTimer,
            readConfig(ad, varsayilan) { return Object.prototype.hasOwnProperty.call(o.ayar, ad) ? o.ayar[ad] : varsayilan; },
            callDBus() { o.dbus.push(Array.prototype.slice.call(arguments)); },
            print() { o.cikti.push(Array.prototype.join.call(arguments, " ")); },
            trsSinamaKancasi(ic) { o.ic = ic; },
            __simdi() { return o.simdi; }, __rastgele() { return o.rastgele(); }
        };
        vm.createContext(baglam);
        vm.runInContext("Date.now = __simdi; Math.random = __rastgele;", baglam);
        vm.runInContext(KOD, baglam, { filename: BETIK });
    }

    ayarDegistir(ad, deger) { this.ayar[ad] = deger; this.options.configChanged.emit(); }

    // pencere aç / kapat
    ac(o) {
        o = o || {};
        const w = new Pencere(this, o);
        this.pencereler.push(w);
        this.workspace.windowAdded.emit(w);
        return w;
    }
    kapat(w) {
        w.deleted = true;
        this.pencereler = this.pencereler.filter(function (p) { return p !== w; });
        this.workspace.windowRemoved.emit(w);
    }
    ipucu() {                                           // ipucu/menü: olağan pencere değildir, hemen kapanır
        const w = this.ac({ sinif: "ipucu", normal: false, geo: { x: 500, y: 500, width: 200, height: 30 } });
        this.kapat(w);
    }

    alan(w) { return w.output.alan; }
    yer(w) {
        if (w.minimized) { return "kucultulmus"; }
        if (w.fullScreen) { return "tamekran"; }
        if (w.maximizeMode === 3) { return "tam"; }
        const a = this.alan(w), g = w._geo, y = Math.floor(a.width / 2);
        const ayni = function (p, q) { return Math.abs(p.x - q.x) <= 2 && Math.abs(p.y - q.y) <= 2 && Math.abs(p.width - q.width) <= 2 && Math.abs(p.height - q.height) <= 2; };
        if (ayni(g, { x: a.x, y: a.y, width: y, height: a.height })) { return "sol"; }
        if (ayni(g, { x: a.x + y, y: a.y, width: a.width - y, height: a.height })) { return "sag"; }
        if (ayni(g, a)) { return "tam"; }
        return "ozel";
    }
    ortada(w, cerceve) {                                // pencere, çerçevenin ortasında mı
        const c = cerceve || this.alan(w), g = w._geo;
        return Math.abs((g.x + g.width / 2) - (c.x + c.width / 2)) <= 2 && Math.abs((g.y + g.height / 2) - (c.y + c.height / 2)) <= 2;
    }
    kayit(w) { return this.ic.durum.get(String(w.internalId)); }
}

class Pencere {
    constructor(ortam, o) {
        this.ortam = ortam;
        this.internalId = "{pencere-" + (++ortam.pencereNo) + "}";
        this.resourceClass = o.sinif !== undefined ? o.sinif : "genel";
        this.desktopFileName = o.dosya !== undefined ? o.dosya : this.resourceClass;
        this.caption = o.baslik || this.resourceClass;
        this.dialog = !!o.iletisim;                     // X11 türü "iletişim kutusu": olağan pencere değildir
        this.normalWindow = o.normal !== false && !this.dialog;
        this.popupWindow = false;
        this.transientFor = o.ana || null;              // programın bildirdiği ana pencere
        this.transient = !!o.bagli || !!o.ana;
        this.deleted = false;
        this.onAllDesktops = !!o.tumMasaustleri;
        this.keepAbove = !!o.ustte;
        this._boyutlanir = o.boyutlanir !== false;
        this.moveable = true;
        this.skipTaskbar = !!o.gizli;
        this.maximizable = o.buyutulebilir !== false;
        this.minimized = false;
        this.fullScreen = false;
        this.pid = o.pid || (o.ana ? o.ana.pid : 1000 + ortam.pencereNo);
        this.output = o.ekran || (o.ana ? o.ana.output : ortam.ekranlar[0]);
        this.desktops = this.onAllDesktops ? [] : (o.masaustleri || [o.masaustu || (o.ana && o.ana.desktops[0]) || ortam.masaustleri[0]]);
        this.activities = o.etkinlikler || (ortam.etkinlikler.length > 1 ? [o.etkinlik || ortam.etkinlikler[0]] : []);
        this.maximizeMode = 0;                          // pencerenin yanıt verdikten SONRAKİ durumu
        this._istenen = 0;                              // en son İSTENEN büyütme durumu
        this.tile = null;                               // kenara yaslanmışsa döşeme nesnesi (istenen)
        const a = this.output.alan;
        this._geo = o.geo ? Object.assign({}, o.geo) : { x: a.x + 200, y: a.y + 100, width: 1200, height: 800 };
        if (o.ana && !o.geo) {                          // KWin bağlı pencereyi ana pencerenin ortasına koyar
            const g = o.ana._geo, en = o.en || 300, boy = o.boy || 200;
            this._geo = { x: Math.round(g.x + (g.width - en) / 2) + (o.kaydir ? o.kaydir.x : 0), y: Math.round(g.y + (g.height - boy) / 2) + (o.kaydir ? o.kaydir.y : 0), width: en, height: boy };
            this._geo.x = Math.max(a.x, Math.min(this._geo.x, a.x + a.width - en));      // KWin ekrandan taşırmaz
            this._geo.y = Math.max(a.y, Math.min(this._geo.y, a.y + a.height - boy));
        }
        this._onceki = Object.assign({}, o.onceki || this._geo);
        this.gecikme = o.gecikme !== undefined ? o.gecikme : ortam.gecikme;
        this.yankiGecikme = o.yankiGecikme || 0;        // döşeme sinyalinin ayrıca gecikmesi (ms)
        this.enKucukEn = o.enKucukEn || 0;              // pencere bundan dar olamaz (yarıya sığmayan program)
        this.betikIslem = 0;                            // betiğin bu pencereye yaptığı işlem sayısı
        for (const ad of PENCERE_SINYALLERI) { this[ad] = new Sinyal(); }
        if (o.buyuk) { this.maximizeMode = 3; this._istenen = 3; this._onceki = Object.assign({}, o.onceki || this._geo); this._geo = Object.assign({}, a); }
    }
    _geoKoy(g) {
        const e = this._geo;
        if (e.x === g.x && e.y === g.y && e.width === g.width && e.height === g.height) { return; }
        this._geo = Object.assign({}, g);
        this.frameGeometryChanged.emit(e);
    }
    get resizeable() { return this._boyutlanir && !this.fullScreen; }   // KWin: tam ekrandaki pencere boyutlanamaz
    get frameGeometry() { return Object.assign({}, this._geo); }
    set frameGeometry(g) {
        this.betikIslem++;
        const hedef = { x: g.x, y: g.y, width: Math.max(g.width, this.enKucukEn), height: g.height };
        const w = this;
        this._uygula(function () { if (w.maximizeMode === 0) { w._geoKoy(hedef); } else { w._onceki = hedef; } });
    }
    setMaximize(dikey, yatay) { this.betikIslem++; this._buyut(dikey && yatay ? 3 : 0); }
    _buyut(kip) {
        if (this._istenen === kip) { return; }          // KWin: istenen durum aynıysa hiçbir şey yaymaz
        this.maximizedAboutToChange.emit(kip);          // KWin bunu istek anında, eşzamanlı yayar
        this._istenen = kip;
        if (kip === 3) { this._doseBirak(); }           // büyütülen pencere döşemeden çıkar
        const w = this;
        this._uygula(function () {
            if (kip === 3 && w.maximizeMode !== 3) { w._onceki = Object.assign({}, w._geo); w.maximizeMode = 3; w._geoKoy(w.output.alan); }
            else if (kip === 0 && w.maximizeMode === 3) { w.maximizeMode = 0; w._geoKoy(w._onceki); }
            w.maximizeMode = kip;
            w.maximizedChanged.emit();
        });
    }
    // Döşeme sinyalleri KWin'de pencere yanıt verince, yani GECİKMELİ gelir
    _doseSinyali() {
        const w = this;
        const yay = function () { if (!w.deleted) { w.tileChanged.emit(w.tile); w.quickTileModeChanged.emit(); } };
        const ms = this.gecikme + this.yankiGecikme;
        if (ms > 0) { this.ortam.zamanla(ms, yay); this.ortam.isler[this.ortam.isler.length - 1].pencereIsi = true; } else { yay(); }
    }
    _doseBirak() { if (this.tile) { this.tile = null; this._doseSinyali(); } }
    _uygula(is) {
        const w = this;
        if (this.gecikme > 0) {
            const id = this.ortam.zamanla(this.gecikme, function () { if (!w.deleted) { is(); } });
            this.ortam.isler[this.ortam.isler.length - 1].pencereIsi = true;
            return id;
        }
        is();
    }

    // kullanıcının (ya da programın kendisinin) yaptıkları: betik bunları ancak sinyalden öğrenir
    kBuyut() { this._buyut(3); }
    kKucult() { this._buyut(0); }
    kTut() { this.interactiveMoveResizeStarted.emit(); }
    kSurukle(g) {                                       // sürüklerken: istenen yer bildirilir, pencere oraya gelir
        if (this.maximizeMode !== 0) { this.maximizedAboutToChange.emit(0); this.maximizeMode = 0; this._istenen = 0; this.maximizedChanged.emit(); }
        this.interactiveMoveResizeStepped.emit(Object.assign({}, g));
        this._geoKoy(g);
    }
    kBirak() { this.interactiveMoveResizeFinished.emit(); }
    kTasi(g) { this.kTut(); this.kSurukle(g); this.kBirak(); }
    kTutBirak() { this.kTut(); this.kBirak(); }
    kHizliBoyut(g, ms) {                                // bırakıldığında pencere yeni boyutuna henüz gelmemiş
        this.kTut(); this.interactiveMoveResizeStepped.emit(Object.assign({}, g)); this.kBirak();
        const w = this; this.ortam.zamanla(ms, function () { if (!w.deleted) { w._geoKoy(g); } });
        this.ortam.isler[this.ortam.isler.length - 1].pencereIsi = true;
    }
    kYasla(taraf) {
        const a = this.output.alan, y = Math.floor(a.width / 2), w = this;
        if (this.maximizeMode !== 0) { this.maximizedAboutToChange.emit(0); this.maximizeMode = 0; this._istenen = 0; this.maximizedChanged.emit(); }
        this.tile = { taraf: taraf, unmanage(p) { if (p === w) { w._doseBirak(); } } };
        this._geoKoy({ x: taraf === "sol" ? a.x : a.x + y, y: a.y, width: taraf === "sol" ? y : a.width - y, height: a.height });
        this._doseSinyali();
    }
    kTamEkran(ac) { this.fullScreen = ac; this.fullScreenChanged.emit(); }
    kSimge(ac) { this.minimized = ac; this.minimizedChanged.emit(); }
    kMasaustu(m) { this.desktops = [m]; this.desktopsChanged.emit(); }
    kEtkinlik(liste) { this.activities = liste; this.activitiesChanged.emit(); }
    kEkran(e) { const eski = this.output; this.output = e; this._geoKoy({ x: e.alan.x + 200, y: 100, width: 1200, height: 800 }); this.outputChanged.emit(eski); }
    kUstte(ac) { this.keepAbove = ac; this.keepAboveChanged.emit(); }
    // programın kendi yaptıkları
    pBoyut(g) { this._geoKoy(g); }
    pSinif(sinif) { this.resourceClass = sinif; this.windowClassChanged.emit(); }
    pDosya(dosya) { this.desktopFileName = dosya; this.desktopFileNameChanged.emit(); }
}

// ── Sınama altyapısı ───────────────────────────────────────────────────────────────────────────
let gecen = 0;
const kalan = [];

function bekle(kosul, ileti) { if (!kosul) { throw new Error(ileti); } }
function esit(gercek, beklenen, ne) { if (gercek !== beklenen) { throw new Error(ne + ": beklenen «" + beklenen + "», çıkan «" + gercek + "»"); } }
function hatasiz(o) {
    const h = o.cikti.filter(function (s) { return s.indexOf("hata") !== -1; });
    bekle(h.length === 0, "betik hata yazdı: " + h.join(" / "));
}
function senaryo(ad, is) {
    try {
        is();
        gecen++;
        if (AYRINTI) { console.log("  geçti   " + ad); }
    } catch (hata) {
        kalan.push(ad + " → " + hata.message);
        console.log("  KALDI   " + ad + "\n          " + hata.message);
    }
}
const FF = { sinif: "org.mozilla.firefox" }, KON = { sinif: "org.kde.konsole" }, KATE = { sinif: "org.kde.kate" };
const SUB = { sinif: "sublime_text" }, AS = { sinif: "jetbrains-studio" }, DIS = { sinif: "discord" };
const KUCUK = { x: 600, y: 300, width: 500, height: 300 };

// ── 1. Senaryolar ──────────────────────────────────────────────────────────────────────────────
console.log("1. Senaryolar");

senaryo("tek kuralsız pencere ekranı kaplar", function () {
    const o = new Ortam(); const a = o.ac(); o.otur();
    esit(o.yer(a), "tam", "a"); hatasiz(o);
});
senaryo("iki kuralsız pencere: önce açılan solda, sonraki sağda", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); o.otur(); const b = o.ac({ sinif: "b" }); o.otur();
    esit(o.yer(a), "sol", "a"); esit(o.yer(b), "sag", "b");
});
senaryo("üçüncü kuralsız pencere bir yarıya gider, öbürleri yerinde kalır; kapanınca geri toparlanır", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); o.otur();
    const c = o.ac({ sinif: "c" }); o.otur();
    esit(o.yer(a), "sol", "a"); esit(o.yer(b), "sag", "b"); bekle(["sol", "sag"].includes(o.yer(c)), "c yarıda değil: " + o.yer(c));
    const ilk = o.yer(c);
    o.ac({ sinif: "d" }); o.otur(); esit(o.yer(c), ilk, "c dördüncü pencere açılınca yer değiştirdi");
    o.kapat(c); o.otur(); esit(o.yer(a), "sol", "a kapanış sonrası");
    o.kapat(b); o.otur();
    const kalanlar = o.pencereler.filter(function (w) { return w.normalWindow; });
    esit(kalanlar.length, 2, "kalan pencere");
    bekle(o.yer(kalanlar[0]) !== o.yer(kalanlar[1]), "iki pencere aynı yarıda kaldı");
    o.kapat(kalanlar[1]); o.otur(); esit(o.yer(kalanlar[0]), "tam", "tek kalan");
});
senaryo("Firefox tek başına tam ekran; terminal gelince Firefox sağ, terminal sol; terminal kapanınca yine tam", function () {
    const o = new Ortam(); const f = o.ac(FF); o.otur(); esit(o.yer(f), "tam", "firefox tek");
    const k = o.ac(KON); o.otur(); esit(o.yer(f), "sag", "firefox"); esit(o.yer(k), "sol", "konsole");
    o.kapat(k); o.otur(); esit(o.yer(f), "tam", "firefox yine tek");
});
senaryo("Sublime tek başına bile sağda", function () {
    const o = new Ortam(); const s = o.ac(SUB); o.otur(); esit(o.yer(s), "sag", "sublime");
});
senaryo("Firefox + Sublime: Firefox üstün, sağda kalır; Sublime sola geçer (açılış sırası fark etmez)", function () {
    let o = new Ortam(); let f = o.ac(FF); let s = o.ac(SUB); o.otur(); esit(o.yer(f), "sag", "firefox"); esit(o.yer(s), "sol", "sublime");
    o = new Ortam(); s = o.ac(SUB); o.otur(); f = o.ac(FF); o.otur(); esit(o.yer(f), "sag", "firefox (sonra açıldı)"); esit(o.yer(s), "sol", "sublime (önce açıldı)");
});
senaryo("terminal + Kate: terminal üstün, solda kalır; Kate sağa geçer", function () {
    const o = new Ortam(); const k = o.ac(KATE); o.otur(); const t = o.ac(KON); o.otur();
    esit(o.yer(t), "sol", "konsole"); esit(o.yer(k), "sag", "kate");
});
senaryo("iki terminal: sonradan açılan karşıya geçer", function () {
    const o = new Ortam(); const a = o.ac(KON); const b = o.ac(KON); o.otur();
    esit(o.yer(a), "sol", "ilk"); esit(o.yer(b), "sag", "ikinci");
});
senaryo("üç 'sağ' kurallı pencere: en az üstün olan sola geçer", function () {
    const o = new Ortam(); const f = o.ac(FF); const ok = o.ac({ sinif: "org.kde.okular" }); const z = o.ac({ sinif: "org.zealdocs.zeal" }); o.otur();
    esit(o.yer(f), "sag", "firefox"); esit(o.yer(ok), "sag", "okular"); esit(o.yer(z), "sol", "zeal");
});
senaryo("Android Studio hep tam ekran; yanındaki terminal solda; iki 'sol' pencere varsa biri sağa geçer", function () {
    const o = new Ortam(); const s = o.ac(AS); o.otur(); esit(o.yer(s), "tam", "studio tek");
    const t = o.ac(KON); o.otur(); esit(o.yer(s), "tam", "studio"); esit(o.yer(t), "sol", "konsole");
    const k = o.ac(KATE); o.otur(); esit(o.yer(t), "sol", "konsole"); esit(o.yer(k), "sag", "kate"); esit(o.yer(s), "tam", "studio hâlâ tam");
});
senaryo("Discord ortada küçük açılır, sayılmaz, sonra dokunulmaz", function () {
    const o = new Ortam(); const t = o.ac(KON); o.otur(); const d = o.ac(DIS); o.otur();
    esit(o.yer(t), "tam", "konsole (discord sayılmamalı)"); esit(o.yer(d), "ozel", "discord"); bekle(o.ortada(d), "discord ortada değil");
    esit(d._geo.width, Math.round(1920 * 0.58), "discord eni");
    const islem = d.betikIslem; o.ac(FF); o.otur(); esit(d.betikIslem, islem, "discord'a sonradan dokunuldu");
});
senaryo("elle büyütülen Firefox büyük kalır; terminal solda kalır; yeni pencere açılınca da bozulmaz", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    f.kBuyut(); o.otur(); esit(o.yer(f), "tam", "firefox"); esit(o.yer(t), "sol", "konsole"); bekle(o.kayit(f).elle, "elle işareti yok");
    const islem = f.betikIslem; o.ac(KATE); o.otur(); esit(o.yer(f), "tam", "firefox yeni pencereden sonra"); esit(f.betikIslem, islem, "elle pencereye dokunuldu");
});
senaryo("ipucu çıktıktan hemen sonra yapılan elle büyütme kaybolmaz (Eclipse'te görülen hata)", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); const c = o.ac({ sinif: "c" }); o.otur();
    for (let i = 0; i < 5; i++) { o.ipucu(); o.ilerle(40); }
    o.ipucu(); o.ilerle(100); c.kBuyut(); o.ipucu(); o.otur();
    esit(o.yer(c), "tam", "c"); bekle(o.kayit(c).elle, "elle işareti yok");
    for (let i = 0; i < 20; i++) { o.ipucu(); o.ilerle(150); }
    esit(o.yer(c), "tam", "c ipuçlarından sonra");
});
senaryo("ipucu ve menüler yeniden dizmeyi tetiklemez", function () {
    const o = new Ortam(); o.ac(FF); o.ac(KON); o.otur();
    const diz = o.ic.sayaclar.diz;
    for (let i = 0; i < 200; i++) { o.ipucu(); o.ilerle(30); }
    o.otur(); esit(o.ic.sayaclar.diz, diz, "dizme sayısı"); esit(o.ic.durum.size, 2, "ipuçları kayıt bıraktı");
});
senaryo("program açılırken kendini büyütürse elle sayılmaz, kural uygulanır", function () {
    const o = new Ortam(); const t = o.ac(KON); o.otur(); const f = o.ac(FF); o.ilerle(300); f.kBuyut(); o.otur();
    esit(o.yer(f), "sag", "firefox"); bekle(!o.kayit(f).elle, "program büyütmesi elle sayıldı"); esit(o.yer(t), "sol", "konsole");
});
senaryo("program açıldıktan 0,7 ve 1,4 saniye sonra kendini büyütürse de elle sayılmaz", function () {
    for (const ne of [700, 1400]) {
        const o = new Ortam(); const t = o.ac(KON); o.otur(); const f = o.ac(FF); o.ilerle(ne); f.kBuyut(); o.otur();
        esit(o.yer(f), "sag", "firefox (" + ne + " ms)"); bekle(!o.kayit(f).elle, "program büyütmesi elle sayıldı (" + ne + " ms)");
    }
});
senaryo("açıldıktan 2 saniye sonra yapılan büyütme elle sayılır", function () {
    const o = new Ortam(); const t = o.ac(KON); o.otur(); const f = o.ac(FF); o.ilerle(2000); f.kBuyut(); o.otur();
    esit(o.yer(f), "tam", "firefox"); bekle(o.kayit(f).elle, "elle sayılmadı");
});
senaryo("'orta' kurallı program açılırken kendini büyütürse yeniden ortalanır", function () {
    const o = new Ortam(); const e = o.ac({ sinif: "Eclipse" }); o.ilerle(700); e.kBuyut(); o.otur();
    esit(e.maximizeMode, 0, "büyük kaldı"); esit(e._geo.width, Math.round(1920 * 0.8), "en"); bekle(!o.kayit(e).elle, "elle sayıldı");
});
senaryo("geç yanıt: yoldaki küçültme isteği varken 'tam' gerekirse hemen yeniden istenir (1 saniye beklenmez)", function () {
    const o = new Ortam({ gecikme: 400 }); const a = o.ac({ sinif: "a" }); o.otur(); esit(o.yer(a), "tam", "a tek");
    const b = o.ac({ sinif: "b" }); o.ilerle(200);      // a için "sol yarı" isteği yolda
    o.kapat(b); o.ilerle(700);                          // a yeniden tek: doğrulamayı beklemeden büyümüş olmalı
    esit(o.yer(a), "tam", "a (yoldaki istek ezilmeliydi)");
});
senaryo("yarıya sığmayan pencereyle çekişme sürmez: birkaç denemeden sonra bırakılır", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a", enKucukEn: 1300 }); const b = o.ac({ sinif: "b" }); o.otur(); o.otur(); o.otur();
    const islem = o.ic.sayaclar.islem; o.ilerle(30000);
    esit(o.ic.sayaclar.islem, islem, "sığmayan pencereye istek yinelenmeye devam ediyor"); bekle(a.betikIslem <= 8, "çok fazla deneme: " + a.betikIslem);
    esit(o.yer(b), "sag", "b");
});
senaryo("pencereyi tutup bırakmak (oynatmadan) elle sayılmaz; taşımak sayılır", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    t.kTutBirak(); o.otur(); bekle(!o.kayit(t).elle, "tutup bırakma elle sayıldı");
    t.kTasi({ x: 100, y: 100, width: 700, height: 500 }); o.otur(); bekle(o.kayit(t).elle, "taşıma elle sayılmadı");
    esit(o.yer(t), "ozel", "konsole"); esit(o.yer(f), "sag", "firefox");
});
senaryo("kenara yaslama elle sayılır ve öbür pencere karşıya yerleşir", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); o.otur();
    a.kYasla("sag"); o.otur(); bekle(o.kayit(a).elle, "elle yok"); esit(o.yer(a), "sag", "a"); esit(o.yer(b), "sol", "b karşıya geçmeli");
});
senaryo("yardımcı: aynı programın küçük penceresi ana pencerenin ortasına konur, sayılmaz", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ pid: 77 }, FF)); const t = o.ac(KON); o.otur();
    const y = o.ac(Object.assign({ pid: 77, geo: KUCUK }, FF)); o.otur();
    esit(o.yer(f), "sag", "firefox"); esit(o.yer(t), "sol", "konsole"); bekle(o.kayit(y).yardimci, "yardımcı sayılmadı");
    esit(y._geo.width, 500, "yardımcının eni değişti"); bekle(o.ortada(y, f._geo), "yardımcı ana pencerenin ortasında değil");
});
senaryo("yardımcı, ana pencere başka yere konunca onunla taşınır", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ pid: 77 }, FF)); const t = o.ac(KON); o.otur();
    const y = o.ac(Object.assign({ pid: 77, geo: KUCUK }, FF)); o.otur();
    o.kapat(t); o.otur(); esit(o.yer(f), "tam", "firefox tek kaldı"); bekle(o.ortada(y, f._geo), "yardımcı ana pencereyi izlemedi");
});
senaryo("elle taşınan yardımcı artık ana pencereyi izlemez", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ pid: 77 }, FF)); const t = o.ac(KON); o.otur();
    const y = o.ac(Object.assign({ pid: 77, geo: KUCUK }, FF)); o.otur();
    y.kTasi({ x: 50, y: 50, width: 500, height: 300 }); o.otur(); o.kapat(t); o.otur();
    esit(y._geo.x, 50, "yardımcı yerinden oynatıldı");
});
senaryo("kurallı programın küçük penceresi, ana penceresi yoksa ana pencere sayılır ve yerleştirilir", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ geo: KUCUK }, FF)); o.otur();
    esit(o.yer(f), "tam", "tek firefox"); bekle(!o.kayit(f).yardimci, "yardımcı sayıldı");
});
senaryo("kuralsız küçük pencere kendi boyutunda ortada kalır; kuralsız büyük pencere kaplar", function () {
    let o = new Ortam(); const k = o.ac({ sinif: "bilinmeyen", geo: KUCUK }); o.otur();
    esit(o.yer(k), "ozel", "küçük"); esit(k._geo.width, 500, "en"); bekle(o.ortada(k), "ortada değil");
    o = new Ortam(); const b = o.ac({ sinif: "bilinmeyen" }); o.otur(); esit(o.yer(b), "tam", "büyük");
});
senaryo("küçük açılıp hemen büyüyen pencere yardımcı sayılmaktan çıkar", function () {
    const o = new Ortam(); const w = o.ac({ sinif: "bilinmeyen", geo: KUCUK }); o.ilerle(150);
    w._geo = { x: 100, y: 100, width: 1300, height: 800 }; o.otur();
    bekle(!o.kayit(w).yardimci, "hâlâ yardımcı"); esit(o.yer(w), "tam", "pencere");
});
senaryo("dosya seçici (kural: yardimci) büyük açılsa da küçültülüp ortalanır", function () {
    const o = new Ortam(); const f = o.ac(FF); o.otur();
    const d = o.ac({ sinif: "org.freedesktop.impl.portal.desktop.kde", buyuk: true, onceki: { x: 0, y: 0, width: 900, height: 600 } }); o.otur();
    esit(d.maximizeMode, 0, "hâlâ büyük"); esit(d._geo.width, 900, "en"); bekle(o.ortada(d), "ortada değil"); esit(o.yer(f), "tam", "firefox etkilenmemeli");
});
senaryo("Eclipse: küçük açılış penceresi boyutunu korur, ana pencere ortada %80 x %90", function () {
    const o = new Ortam(); const s = o.ac({ sinif: "Eclipse", geo: KUCUK }); o.otur();
    esit(s._geo.width, 500, "açılış penceresi eni"); bekle(o.ortada(s), "açılış penceresi ortada değil");
    const a = o.ac({ sinif: "Eclipse" }); o.otur();
    esit(a._geo.width, Math.round(1920 * 0.8), "ana pencere eni"); esit(a._geo.height, Math.round(1080 * 0.9), "boy"); bekle(o.ortada(a), "ortada değil");
    a.kBuyut(); o.otur(); o.ipucu(); o.ac(KON); o.otur(); esit(o.yer(a), "tam", "elle büyütülen Eclipse");
});
senaryo("tam ekran video: öbür pencereler yer değiştirmez", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    const islem = t.betikIslem; f.kTamEkran(true); o.otur(); esit(o.yer(t), "sol", "konsole tam ekran sırasında"); esit(t.betikIslem, islem, "konsole'a dokunuldu");
    f.kTamEkran(false); o.otur(); esit(o.yer(f), "sag", "firefox çıkınca"); esit(o.yer(t), "sol", "konsole çıkınca");
});
senaryo("simge durumuna küçültülen sayılmaz; geri gelince düzen eski hâline döner", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    t.kSimge(true); o.otur(); esit(o.yer(f), "tam", "firefox tek sayılmalı");
    t.kSimge(false); o.otur(); esit(o.yer(f), "sag", "firefox"); esit(o.yer(t), "sol", "konsole");
});
senaryo("masaüstleri birbirinden bağımsız; pencere taşınınca iki masaüstü de yeniden dizilir", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); const k = o.ac(Object.assign({ masaustu: o.masaustleri[4] }, KATE)); o.otur();
    esit(o.yer(k), "tam", "kate 5. masaüstünde tek"); esit(o.yer(f), "sag", "firefox");
    t.kMasaustu(o.masaustleri[4]); o.otur(); esit(o.yer(f), "tam", "firefox tek kaldı"); esit(o.yer(t), "sol", "konsole"); esit(o.yer(k), "sag", "kate");
});
senaryo("iki ekran birbirinden bağımsız", function () {
    const o = new Ortam({ ekran: 2 }); const f = o.ac(FF); const t = o.ac(Object.assign({ ekran: o.ekranlar[1] }, KON)); o.otur();
    esit(o.yer(f), "tam", "firefox 1. ekranda tek"); esit(o.yer(t), "tam", "konsole 2. ekranda tek");
    t.kEkran(o.ekranlar[0]); o.otur(); esit(o.yer(f), "sag", "firefox"); esit(o.yer(t), "sol", "konsole");
});
senaryo("sayılmayanlar: iletişim kutusu, bağlı pencere, üstte, tüm masaüstleri, sabit boyut, HARIC", function () {
    const o = new Ortam(); const f = o.ac(FF); o.otur();
    const liste = [o.ac({ sinif: "x", iletisim: true }), o.ac({ sinif: "x", bagli: true }), o.ac({ sinif: "x", ustte: true }),
        o.ac({ sinif: "x", tumMasaustleri: true }), o.ac({ sinif: "x", boyutlanir: false }), o.ac({ sinif: "vlc" }), o.ac({ sinif: "x", gizli: true })];
    o.otur(); esit(o.yer(f), "tam", "firefox tek sayılmalı");
    for (const w of liste) { esit(w.betikIslem, 0, "sayılmayan pencereye dokunuldu (" + liste.indexOf(w) + ")"); }
});
senaryo("pencere 'her zaman üstte' yapılınca sayılmaktan çıkar", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    t.kUstte(true); o.otur(); esit(o.yer(f), "tam", "firefox");
});
senaryo("kurallar değişince betik yeniden yüklenmez, elle işaretleri korunur", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); const k = o.ac(KATE); o.otur();
    f.kBuyut(); o.otur();
    const yeni = JSON.parse(JSON.stringify(TEST_KURALLARI)); yeni.k[6] = ["kate", "tam"];
    o.ayarDegistir("Kurallar", JSON.stringify(yeni)); o.otur();
    esit(o.yer(k), "tam", "kate yeni kural"); bekle(o.kayit(f).elle, "elle işareti silindi"); esit(o.yer(f), "tam", "firefox");
});
senaryo("bozuk kural metni gelirse eldeki kurallar kalır", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    o.ayarDegistir("Kurallar", "{bozuk"); o.otur(); const k = o.ac(KATE); const y = o.ac({ sinif: "yalnizsinamada" }); o.otur();
    esit(o.yer(t), "sol", "konsole"); esit(o.yer(f), "sag", "firefox"); bekle(["sol", "sag"].includes(o.yer(k)), "kate");
    esit(o.yer(y), "tam", "yalnızca eldeki kurallarda bulunan kural kayboldu");
});
senaryo("betik yeniden yüklenince hiçbir pencere oynamaz; uymayanlar elle sayılır", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); const k = o.ac(KATE); o.otur();
    f.kBuyut(); o.otur();
    const once = o.pencereler.map(function (w) { return w.betikIslem; });
    o.betikYukle(); o.otur();
    o.pencereler.forEach(function (w, i) { esit(w.betikIslem, once[i], "yeniden yüklemede dokunuldu: " + w.resourceClass); });
    bekle(o.kayit(f).elle, "elle büyütülmüş firefox yönetilen sayıldı"); bekle(!o.kayit(t).elle, "konsole elle sayıldı");
    o.kapat(k); o.otur(); esit(o.yer(f), "tam", "firefox"); esit(o.yer(t), "sol", "konsole yönetilmeye devam etmeli");
});
senaryo("sıfırlama elle işaretlerini siler ve baştan dizer", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    f.kBuyut(); t.kTasi({ x: 10, y: 10, width: 600, height: 400 }); o.otur();
    o.ayarDegistir("SifirlaIste", "1"); o.otur(); esit(o.yer(f), "sag", "firefox"); esit(o.yer(t), "sol", "konsole");
});
senaryo("durum raporu istenince gönderilir, başka zaman gönderilmez", function () {
    const o = new Ortam(); o.ac(FF); o.otur();
    o.options.configChanged.emit(); esit(o.dbus.length, 0, "istenmeden rapor");
    o.ayarDegistir("RaporIste", "abc"); esit(o.dbus.length, 1, "rapor"); bekle(String(o.dbus[0][4]).indexOf("org.mozilla.firefox") !== -1, "raporda pencere yok");
});
senaryo("geç yanıt veren pencereler (800 ms) yanlışlıkla elle sayılmaz ve doğru yere oturur", function () {
    const o = new Ortam({ gecikme: 800 }); const f = o.ac(FF); const t = o.ac(KON); o.otur(); const k = o.ac(KATE); o.otur(); o.otur();
    esit(o.yer(f), "sag", "firefox"); esit(o.yer(t), "sol", "konsole"); esit(o.yer(k), "sol", "kate (üçüncü, kendi yarısı)");
    for (const w of [f, t, k]) { bekle(!o.kayit(w).elle, w.resourceClass + " elle sayıldı"); }
});
senaryo("yerine oturduktan sonra boşta hiçbir işlem yapılmaz (çekişme yok)", function () {
    const o = new Ortam({ gecikme: 120 }); o.ac(FF); o.ac(KON); o.ac(KATE); o.ac(DIS); o.ac({ sinif: "a" }); o.otur(); o.otur();
    const once = o.ic.sayaclar.islem;
    for (let i = 0; i < 30; i++) { o.workspace.desktopsChanged.emit(); o.ilerle(500); }
    esit(o.ic.sayaclar.islem, once, "boşta işlem sayısı");
});
senaryo("büyütülemeyen pencere de alanı kaplar", function () {
    const o = new Ortam(); const w = o.ac({ sinif: "a", buyutulebilir: false }); o.otur(); esit(o.yer(w), "tam", "pencere");
});
senaryo("kapanırken bekleyen zamanlayıcılar hata vermez", function () {
    const o = new Ortam(); const f = o.ac(FF); const d = o.ac({ sinif: "org.freedesktop.impl.portal.desktop.kde", buyuk: true }); o.ilerle(50);
    o.kapat(d); const k = o.ac({ sinif: "x", geo: KUCUK }); o.ilerle(100); o.kapat(k); o.otur(); hatasiz(o); esit(o.yer(f), "tam", "firefox");
});
senaryo("sınıfı sonradan belli olan pencere kuralına kavuşur", function () {
    const o = new Ortam(); const t = o.ac(KON); const w = o.ac({ sinif: "" }); o.otur();
    w.resourceClass = "org.mozilla.firefox"; w.desktopFileName = "org.mozilla.firefox"; w.windowClassChanged.emit(); o.otur();
    esit(o.yer(w), "sag", "firefox"); esit(o.yer(t), "sol", "konsole");
});

// — pencere kapanınca —
senaryo("kapanış: kalan pencere kapanış canlandırması bitince (0,26 sn) büyür; daha erken ya da çok geç değil", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    o.kapat(t); o.ilerle(200); esit(o.yer(f), "sag", "canlandırma bitmeden oynatıldı"); o.ilerle(100); esit(o.yer(f), "tam", "0,3 saniyede büyümedi");
});
senaryo("kapanış beklemesini araya giren başka olaylar ya da bekleyen doğrulama kısaltmaz", function () {
    let o = new Ortam(); let f = o.ac(FF); let t = o.ac(KON); o.otur();
    o.kapat(t); o.ilerle(50); o.workspace.desktopsChanged.emit(); o.ipucu(); o.ilerle(170); esit(o.yer(f), "sag", "başka olay beklemeyi kısalttı");
    o.ilerle(100); esit(o.yer(f), "tam", "sonunda büyümeli");
    o = new Ortam(); f = o.ac(FF); t = o.ac(KON); o.ilerle(1000);                 // doğrulama 1190. ms'de çalışacak
    o.kapat(t); o.ilerle(230); esit(o.yer(f), "sag", "doğrulama beklemeyi kısalttı"); o.ilerle(100); esit(o.yer(f), "tam", "sonunda büyümeli");
});
senaryo("kapanış: art arda kapanan pencereler (programdan çıkış, oturumu kapatma) tek dizmede toplanır, ara sıçrama olmaz", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); const c = o.ac({ sinif: "c" }); const d = o.ac({ sinif: "d" }); o.otur();
    const once = a.betikIslem, diz = o.ic.sayaclar.diz;
    o.kapat(b); o.ilerle(180); o.kapat(c); o.ilerle(180); o.kapat(d); o.ilerle(180);
    esit(o.ic.sayaclar.diz, diz, "kapanışlar sürerken dizildi"); esit(a.betikIslem, once, "ara adımda oynatıldı");
    o.otur(); esit(o.yer(a), "tam", "tek kalan"); esit(a.betikIslem, once + 1, "tek işlemle büyümeliydi");
});
senaryo("kapanış: program kapanıp hemen yeniden açılırsa (yeniden başlatma) öbür pencere hiç oynamaz", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    const once = f.betikIslem; o.kapat(t); o.ilerle(150); const t2 = o.ac(KON); o.otur();
    esit(f.betikIslem, once, "firefox boşuna büyütülüp küçültüldü"); esit(o.yer(f), "sag", "firefox"); esit(o.yer(t2), "sol", "yeni konsole");
});
senaryo("kapanış: sayılmayan pencere (iletişim kutusu, yardımcı, 'orta', simge durumundaki, hariç) kapanınca kimse oynamaz, dizme bile çalışmaz", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ pid: 77 }, FF)); const t = o.ac(KON); o.otur();
    const liste = [o.ac({ sinif: "x", ana: f }), o.ac(Object.assign({ pid: 77, geo: KUCUK }, FF)), o.ac(DIS), o.ac({ sinif: "vlc" }), o.ac({ sinif: "y", ustte: true })];
    const s = o.ac(KATE); o.otur(); s.kSimge(true); o.otur(); liste.push(s);
    const diz = o.ic.sayaclar.diz, islem = o.ic.sayaclar.islem;
    for (const w of liste) { o.kapat(w); o.ilerle(500); }
    o.otur(); esit(o.ic.sayaclar.diz, diz, "dizme çalıştı"); esit(o.ic.sayaclar.islem, islem, "pencere oynatıldı");
});
senaryo("kapanış: üç pencereden biri kapanıp kalan ikisi aynı yarıda kalırsa önce açılan sola, sonraki sağa geçer", function () {
    for (const taraf of ["sol", "sag"]) {
        const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); const c = o.ac({ sinif: "c" }); o.otur();
        o.kayit(b).taraf = taraf; o.kayit(c).taraf = taraf; o.kapat(a); o.otur();
        esit(o.yer(b), "sol", "önce açılan (" + taraf + ")"); esit(o.yer(c), "sag", "sonra açılan (" + taraf + ")");
    }
});
senaryo("kapanış: kalan iki pencere zaten ayrı yarılardaysa (sırası ters olsa bile) yerinden oynamaz", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); const c = o.ac({ sinif: "c" }); o.otur();
    o.kayit(b).taraf = "sag"; o.kayit(c).taraf = "sol"; o.ic.hepsiniDiz(); o.otur();
    const once = [b.betikIslem, c.betikIslem]; o.kapat(a); o.otur(); esit(b.betikIslem, once[0], "b"); esit(c.betikIslem, once[1], "c");
});
senaryo("kapanış: ana pencere kapanınca geride kalan yardımcı ve bağlı pencereye dokunulmaz, hata çıkmaz", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ pid: 77 }, FF)); const t = o.ac(KON); o.otur();
    const y = o.ac(Object.assign({ pid: 77, geo: KUCUK }, FF)); const c = o.ac({ sinif: "x", ana: f }); o.otur();
    const once = [y.betikIslem, c.betikIslem]; o.kapat(f); c.transientFor = null; c.transient = false; c.transientChanged.emit(); o.otur(); o.otur();
    esit(c.betikIslem, once[1], "bağı kopan küçük kutu oynatıldı"); esit(c._geo.width, 300, "kutu yarıya gerildi"); hatasiz(o);
    // Firefox'un küçük penceresi artık programın tek penceresi: olağan pencere olur (tek başına açılsaydı da öyle olurdu)
    bekle(!o.kayit(y).yardimci, "yardımcı kaldı"); esit(o.yer(y), "sag", "firefox'un kalan penceresi"); esit(o.yer(t), "sol", "konsole");
});
senaryo("kapanış: yardımcının ana penceresi kapanır ama aynı programın başka penceresi varsa yardımcı kalır ve onun ortasına geçer", function () {
    const o = new Ortam(); const f1 = o.ac(Object.assign({ pid: 77 }, FF)); const f2 = o.ac(Object.assign({ pid: 77 }, FF)); o.otur();
    const y = o.ac(Object.assign({ pid: 77, geo: KUCUK }, FF)); o.otur(); const ana = o.kayit(y).ana === f2.internalId ? f2 : f1; const kalan = ana === f2 ? f1 : f2;
    o.kapat(ana); o.otur(); o.otur(); bekle(o.kayit(y).yardimci, "yardımcılıktan çıktı"); esit(o.yer(kalan), "tam", "kalan firefox"); bekle(o.ortada(y, kalan._geo), "yeni ana pencereyi izlemedi");
});
senaryo("kapanış: kuralsız programın küçük penceresi, büyük penceresi kapansa da küçük kalır", function () {
    const o = new Ortam(); const b = o.ac({ sinif: "prog", pid: 5 }); o.otur(); const y = o.ac({ sinif: "prog", pid: 5, geo: KUCUK }); o.otur();
    const once = y.betikIslem; o.kapat(b); o.otur(); bekle(o.kayit(y).yardimci, "yardımcılıktan çıktı"); esit(y.betikIslem, once, "oynatıldı");
});
senaryo("kapanış: elle yerleştirilmiş pencere kapanınca kalanlar yeniden dizilir; elle olan kalırsa ona dokunulmaz", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); const k = o.ac(KATE); o.otur(); f.kTasi({ x: 100, y: 100, width: 800, height: 600 }); o.otur();
    const once = f.betikIslem; o.kapat(k); o.otur(); esit(f.betikIslem, once, "elle pencereye dokunuldu");
    o.kapat(f); o.otur(); esit(o.yer(t), "tam", "konsole");
});
senaryo("hatıra: elle yerleştirilip kapanan program (tepsiye kapanan Discord) yeniden açılınca aynı yere gelir ve elle sayılır", function () {
    const o = new Ortam(); const t = o.ac(KON); o.otur(); const d = o.ac(DIS); o.otur();
    const yer = { x: 1100, y: 80, width: 700, height: 900 };
    d.kTasi(yer); o.otur(); o.kapat(d); o.otur();
    const d2 = o.ac(DIS); o.otur(); hatasiz(o);
    esit(JSON.stringify(d2._geo), JSON.stringify(yer), "discord yeri"); bekle(o.kayit(d2).elle, "elle işareti yok");
    const islem = d2.betikIslem; o.ac(FF); o.otur(); esit(d2.betikIslem, islem, "hatıradan konan pencereye sonradan dokunuldu");
});
senaryo("hatıra: elle büyütülüp kapanan Firefox yeniden büyük açılır, terminal solda kalır", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur(); f.kBuyut(); o.otur(); o.kapat(f); o.otur();
    const f2 = o.ac(FF); o.otur(); hatasiz(o); esit(o.yer(f2), "tam", "firefox"); esit(o.yer(t), "sol", "konsole");
});
senaryo("yalnızken tam: hatıradan büyük açılan Firefox'un yanına Sublime gelince bölünür (Sublime sol, Firefox sağ)", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur(); f.kBuyut(); o.otur(); o.kapat(f); o.kapat(t); o.otur();
    const f2 = o.ac(FF); o.otur(); esit(o.yer(f2), "tam", "firefox yalnız"); bekle(o.kayit(f2).elle, "hatıradan elle sayılmadı");
    const s = o.ac(SUB); o.otur(); hatasiz(o);
    esit(o.yer(f2), "sag", "firefox"); esit(o.yer(s), "sol", "sublime"); bekle(!o.kayit(f2).elle, "firefox hâlâ elle");
});
senaryo("yalnızken elle büyütülen pencere: yeni pencere gelince bölünür; kalabalıkta büyütülen bölünmez", function () {
    const o = new Ortam(); const f = o.ac(FF); o.otur(); o.ilerle(2000); f.kTasi({ x: 100, y: 100, width: 800, height: 600 }); o.otur();
    f.kBuyut(); o.otur(); esit(o.yer(f), "tam", "firefox yalnız"); bekle(o.kayit(f).elle, "elle işareti yok");
    const t = o.ac(KON); o.otur(); esit(o.yer(f), "sag", "firefox"); esit(o.yer(t), "sol", "konsole");
    f.kBuyut(); o.otur(); esit(o.yer(f), "tam", "kalabalıkta büyütülen");
    const islem = f.betikIslem; o.ac(KATE); o.otur(); esit(o.yer(f), "tam", "kalabalıkta büyütülen yeni pencereyle"); esit(f.betikIslem, islem, "dokunuldu");
});
senaryo("hatıra: elle dokunulmamış program kurala göre açılır; programın ikinci penceresi hatırayı kullanmaz", function () {
    const o = new Ortam(); const f = o.ac(FF); o.otur(); o.kapat(f); o.otur(); const f2 = o.ac(FF); o.otur();
    bekle(!o.kayit(f2).elle, "dokunulmamış pencere elle sayıldı");
    const k1 = o.ac(KATE); const k2 = o.ac(KATE); o.otur(); k1.kTasi({ x: 100, y: 100, width: 600, height: 500 }); o.otur();
    o.kapat(k1); o.otur(); bekle(!o.kayit(k2).elle, "kalan kate elle sayıldı");
    const k3 = o.ac(KATE); o.otur(); bekle(!o.kayit(k3).elle, "başka penceresi açıkken hatıra kullanıldı");
});
senaryo("hatıra: kurallar değişince ya da sıfırlamada unutulur", function () {
    const o = new Ortam(); const k = o.ac(KATE); o.otur(); k.kTasi({ x: 100, y: 100, width: 600, height: 500 }); o.otur(); o.kapat(k); o.otur();
    o.ayarDegistir("Kurallar", JSON.stringify({ k: [["kate", "sag"]], h: [] })); o.otur();
    const k2 = o.ac(KATE); o.otur(); bekle(!o.kayit(k2).elle, "kural değişiminden sonra hatıra kullanıldı"); esit(o.yer(k2), "tam", "kate");
    k2.kTasi({ x: 100, y: 100, width: 600, height: 500 }); o.otur(); o.kapat(k2); o.otur();
    const k3 = o.ac(KATE); o.otur(); bekle(o.kayit(k3).elle, "hatıra kullanılmadı"); o.kapat(k3); o.otur();
    o.ayarDegistir("SifirlaIste", "1"); o.otur();
    const k4 = o.ac(KATE); o.otur(); bekle(!o.kayit(k4).elle, "sıfırlamadan sonra hatıra kullanıldı"); hatasiz(o);
});
senaryo("kapanış bize bildirilmeden yok olan pencere dizmeyi durdurmaz", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); const k = o.ac(KATE); o.otur();
    o.pencereler = o.pencereler.filter(function (w) { return w !== k; });        // windowRemoved gelmedi
    Object.defineProperty(k, "deleted", { get() { throw new Error("yok edilmiş nesne"); } });
    Object.defineProperty(k, "minimized", { get() { throw new Error("yok edilmiş nesne"); } });
    o.kapat(t); o.otur(); esit(o.yer(f), "tam", "firefox"); hatasiz(o);
});

// — ikinci gözün (Codex) bulduğu durumlar —
senaryo("yeniden yerleştirmeden hemen sonra (100 ms) yapılan elle büyütme geri alınmaz", function () {
    for (const gecikme of [0, 400]) {
        const o = new Ortam({ gecikme: gecikme }); const f = o.ac(FF); o.otur(); o.ac(KON); o.ilerle(100); f.kBuyut(); o.otur(); o.otur();
        esit(o.yer(f), "tam", "firefox (gecikme " + gecikme + ")"); bekle(o.kayit(f).elle, "elle sayılmadı (gecikme " + gecikme + ")");
    }
});
senaryo("açılışın ilk 1,5 saniyesinde: ilk büyütme programın sayılır, ikincisi elledir (çekişme yok)", function () {
    const o = new Ortam(); const f = o.ac(FF); o.ac(KON); o.ilerle(500); f.kBuyut(); o.ilerle(300);
    esit(o.yer(f), "sag", "ilk büyütme geri alınmalı"); bekle(!o.kayit(f).elle, "ilk büyütme elle sayıldı");
    f.kBuyut(); o.otur(); esit(o.yer(f), "tam", "ikinci büyütme kalmalı"); bekle(o.kayit(f).elle, "ikinci büyütme elle sayılmadı");
    const islem = f.betikIslem; o.ilerle(20000); esit(f.betikIslem, islem, "inatçı pencereyle çekişme sürüyor");
});
senaryo("sürüklenen pencereye bırakılana kadar dokunulmaz; öbürleri de yer değiştirmez", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur();
    f.kTut(); f.kSurukle({ x: 300, y: 200, width: 960, height: 1080 });
    const fi = f.betikIslem, ti = t.betikIslem; const k = o.ac(KATE); o.ilerle(400); o.kapat(k); o.ilerle(400); o.ipucu(); o.otur();
    esit(f.betikIslem, fi, "sürüklenen pencereye dokunuldu"); esit(t.betikIslem, ti, "sürükleme sırasında konsole oynatıldı");
    f.kSurukle({ x: 500, y: 300, width: 800, height: 600 }); f.kBirak(); o.otur();
    bekle(o.kayit(f).elle, "bırakınca elle sayılmadı"); esit(f._geo.x, 500, "bırakılan yer"); esit(f.betikIslem, fi, "bıraktıktan sonra dokunuldu");
});
senaryo("sürüklenen pencere, bırakılana kadar eski yarısında sayılır (öbür yarı boş sanılıp pencere kaydırılmaz)", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); o.otur(); const c = o.ac({ sinif: "c" }); o.otur();
    const tek = o.yer(c) === "sol" ? b : a; const otekiler = [a, b, c].filter(function (w) { return w !== tek; });
    const once = otekiler.map(function (w) { return w.betikIslem; });
    tek.kTut(); tek.kSurukle({ x: 400, y: 200, width: 700, height: 500 }); o.ipucu(); o.workspace.desktopsChanged.emit(); o.otur();
    otekiler.forEach(function (w, i) { esit(w.betikIslem, once[i], "sürükleme sırasında oynatıldı: " + w.resourceClass); });
    tek.kBirak(); o.otur(); bekle(o.kayit(tek).elle, "elle");
});
senaryo("ilgisiz bir kural değişimi, açık pencerelerin 'yeni açıldı' hoşgörüsünü yeniden başlatmaz", function () {
    const o = new Ortam(); const f = o.ac(FF); o.ac(KON); o.otur(); o.ilerle(5000);
    const k = JSON.parse(JSON.stringify(TEST_KURALLARI)); k.k.push(["=baska", "sol"]); o.ayarDegistir("Kurallar", JSON.stringify(k)); o.ilerle(300);
    f.kBuyut(); o.otur(); bekle(o.kayit(f).elle, "kural değişiminden hemen sonraki elle büyütme yok sayıldı"); esit(o.yer(f), "tam", "firefox");
});
senaryo("kenara yaslama: sinyali gelmeden araya dizme girse de pencere geri çekilmez", function () {
    const o = new Ortam({ gecikme: 400 }); const f = o.ac(FF); const t = o.ac(KON); o.otur(); o.otur();
    o.workspace.desktopsChanged.emit(); o.ilerle(50); f.kYasla("sol"); o.otur(); o.otur();
    bekle(o.kayit(f).elle, "elle sayılmadı"); esit(o.yer(f), "sol", "firefox yaslandığı yerde kalmalı"); bekle(f.tile !== null, "döşemeden çıkarıldı"); esit(o.yer(t), "sag", "konsole");
});
senaryo("geç yanıt: yoldaki 'tam' isteği varken yarı gerekirse hemen geri alınır (1 saniye beklenmez)", function () {
    const o = new Ortam({ gecikme: 400 }); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); o.otur(); o.otur();
    o.kapat(b); o.ilerle(400); const c = o.ac({ sinif: "c" }); o.ilerle(600);
    esit(o.yer(a), "sol", "a (yoldaki büyütme geri alınmalıydı)"); esit(o.yer(c), "sag", "c");
});
senaryo("geç yanıt: yoldaki istek, araya başka olaylar girse de yinelenmez", function () {
    const o = new Ortam({ gecikme: 400 }); const f = o.ac(FF); const t = o.ac(KON); o.ilerle(100);
    for (let i = 0; i < 6; i++) { o.workspace.desktopsChanged.emit(); o.ilerle(95); }
    esit(f.betikIslem, 1, "firefox'a yapılan istek"); esit(t.betikIslem, 1, "konsole'a yapılan istek"); o.otur(); esit(o.yer(f), "sag", "firefox");
});
senaryo("çok hızlı boyutlandırma: bırakıldığında pencere henüz yeni boyutuna gelmemiş olsa da elle sayılır", function () {
    const o = new Ortam(); const f = o.ac(FF); o.ac(KON); o.otur();
    f.kHizliBoyut({ x: 960, y: 0, width: 700, height: 900 }, 400); o.ilerle(100); bekle(o.kayit(f).elle, "elle sayılmadı");
    o.ac(KATE); o.otur(); esit(f._geo.width, 700, "kullanıcının verdiği boyut bozuldu");
});
senaryo("kenara yaslama sinyali geç gelse de elle sayılır; betiğin taşımasının geç yankısı elle sayılmaz", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ yankiGecikme: 400 }, FF)); const t = o.ac(KON); o.otur();
    f.kYasla("sol"); o.otur(); bekle(o.kayit(f).elle, "yaslama elle sayılmadı"); esit(o.yer(t), "sag", "konsole karşıya geçmeli");
    o.ayarDegistir("SifirlaIste", "s1"); o.otur(); o.otur();
    esit(f.tile, null, "betik pencereyi taşırken döşemeden çıkarmadı"); bekle(!o.kayit(f).elle, "betiğin taşımasının yankısı elle sayıldı");
    esit(o.yer(f), "sag", "firefox"); esit(o.yer(t), "sol", "konsole");
    f.kYasla("sag"); o.otur(); o.ayarDegistir("SifirlaIste", "s2"); o.kapat(t); o.otur(); o.otur();
    esit(o.yer(f), "tam", "tek kalan firefox"); bekle(!o.kayit(f).elle, "büyütmenin döşeme yankısı elle sayıldı");
});
senaryo("bağlı pencere (iletişim kutusu) ana pencere betikçe taşınınca onunla gider; boyutu değişmez", function () {
    for (const gecikme of [0, 400]) {
        const o = new Ortam({ gecikme: gecikme }); const f = o.ac(FF); const t = o.ac(KON); o.otur(); o.otur();
        const c = o.ac({ sinif: "org.mozilla.firefox", ana: f }); o.otur();
        esit(c.betikIslem, 0, "yeni açılan bağlı pencereye dokunuldu"); esit(o.yer(f), "sag", "firefox"); esit(o.yer(t), "sol", "konsole (bağlı pencere sayılmamalı)");
        o.kapat(t); o.otur(); o.otur(); esit(o.yer(f), "tam", "firefox tek"); bekle(o.ortada(c, f._geo), "bağlı pencere izlemedi (gecikme " + gecikme + ")");
        esit(c._geo.width, 300, "bağlı pencerenin eni değişti");
    }
});
senaryo("bağlı pencere, ana pencereyi SEN taşıyınca da onunla gider ve aradaki uzaklığı korur", function () {
    const o = new Ortam(); const f = o.ac(FF); o.ac(KON); o.otur();
    const c = o.ac({ sinif: "org.mozilla.firefox", ana: f, kaydir: { x: 120, y: -60 } }); o.otur();
    f.kTasi({ x: 100, y: 150, width: 900, height: 700 }); o.otur();
    esit(c._geo.x + 150, 100 + 450 + 120, "yatay uzaklık"); esit(c._geo.y + 100, 150 + 350 - 60, "dikey uzaklık");
});
senaryo("X11 türü iletişim kutusu da ana pencereyi izler; elle taşınırsa izlemeyi bırakır", function () {
    const o = new Ortam(); const s = o.ac(AS); o.otur(); const c = o.ac({ sinif: "jetbrains-studio", ana: s, iletisim: true }); o.otur();
    s.kTasi({ x: 0, y: 0, width: 1000, height: 800 }); o.otur(); bekle(o.ortada(c, s._geo), "iletişim kutusu izlemedi");
    c.kTasi({ x: 1500, y: 800, width: 300, height: 200 }); o.otur(); s.kTasi({ x: 200, y: 100, width: 1000, height: 800 }); o.otur();
    esit(c._geo.x, 1500, "elle taşınan bağlı pencere oynatıldı");
});
senaryo("geniş kutu yarıdaki ana pencereye sığmayıp ekran kenarına dayandıysa, ana pencere büyüyünce ORTAYA gelir (canlıda görüldü)", function () {
    const o = new Ortam(); const k = o.ac(KATE); const t = o.ac(KON); o.otur(); esit(o.yer(k), "sag", "kate");
    const c = o.ac({ sinif: "org.kde.kate", ana: k, en: 1141, boy: 638 }); o.otur();
    esit(c._geo.x, 1920 - 1141, "ön koşul: kutu sağ kenara dayalı"); esit(c.betikIslem, 0, "açılışta dokunuldu");
    o.kapat(t); o.otur(); o.otur(); esit(o.yer(k), "tam", "kate tek"); bekle(o.ortada(c, k._geo), "kutu ortaya gelmedi: x=" + c._geo.x);
});
senaryo("bağlı pencere ekrandan taşmaz; ana pencere geri gelince eski uzaklığına döner", function () {
    const o = new Ortam(); const f = o.ac(FF); o.otur(); const c = o.ac({ sinif: "x", ana: f, en: 600, boy: 400 }); o.otur();
    f.kTasi({ x: 1500, y: 700, width: 420, height: 380 }); o.otur();
    bekle(c._geo.x + c._geo.width <= 1920 && c._geo.y + c._geo.height <= 1080, "ekrandan taştı");
    f.kTasi({ x: 300, y: 100, width: 1000, height: 800 }); o.otur(); bekle(o.ortada(c, f._geo), "eski uzaklığa dönmedi");
});
senaryo("ana pencere başka masaüstüne ya da simge durumuna gidince bağlı pencere peşinden sürüklenmez", function () {
    const o = new Ortam(); const f = o.ac(FF); o.otur(); const c = o.ac({ sinif: "x", ana: f }); o.otur();
    f.kSimge(true); f.pBoyut({ x: 300, y: 300, width: 700, height: 500 }); o.otur(); esit(c.betikIslem, 0, "simge"); f.kSimge(false); o.otur(); bekle(o.ortada(c, f._geo), "geri gelince izlemeli"); const ara = c.betikIslem; f.kMasaustu(o.masaustleri[3]); f.pBoyut({ x: 0, y: 0, width: 800, height: 600 }); o.otur();
    esit(c.betikIslem, ara, "başka masaüstü");
});
senaryo("boyutla yardımcı sayılan pencere de ana pencereyi (elle taşınsa bile) izler", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ pid: 77 }, FF)); o.otur();
    const y = o.ac(Object.assign({ pid: 77, geo: KUCUK }, FF)); o.otur(); bekle(o.ortada(y, f._geo), "ilk ortalama");
    f.kTasi({ x: 0, y: 0, width: 960, height: 1080 }); o.otur(); bekle(o.ortada(y, f._geo), "elle taşınan ana pencereyi izlemedi");
});
senaryo("küçük açılan pencere geç de büyüse (0,6 sn, 5 sn) yardımcı sayılmaktan çıkar", function () {
    for (const ne of [600, 5000]) {
        const o = new Ortam(); const w = o.ac({ sinif: "bilinmeyen", geo: KUCUK }); o.ilerle(ne); w.pBoyut({ x: 100, y: 100, width: 1200, height: 800 }); o.otur();
        bekle(!o.kayit(w).yardimci, "hâlâ yardımcı (" + ne + " ms)"); esit(o.yer(w), "tam", "pencere (" + ne + " ms)");
    }
});
senaryo("yardımcıyı kullanıcı elle büyütürse yardımcı kalır, sayılmaz, dokunulmaz", function () {
    const o = new Ortam(); const f = o.ac(FF); o.otur(); const w = o.ac({ sinif: "bilinmeyen", geo: KUCUK }); o.otur();
    w.kTasi({ x: 100, y: 100, width: 1300, height: 900 }); o.otur(); esit(o.yer(f), "tam", "firefox tek sayılmalı"); esit(w._geo.width, 1300, "elle boyut");
});
senaryo("büyük açılan dosya seçici geç yanıt verse de (800 ms) küçülünce ortalanır", function () {
    const o = new Ortam({ gecikme: 800 });
    const w = o.ac({ sinif: "org.freedesktop.impl.portal.desktop.kde", buyuk: true, onceki: { x: 10, y: 10, width: 500, height: 300 } }); o.ilerle(6000);
    esit(w.maximizeMode, 0, "hâlâ büyük"); bekle(o.ortada(w), "ortalanmadı"); bekle(!o.kayit(w).elle, "elle sayıldı"); esit(w._geo.width, 500, "en");
});
senaryo("kimliği sonradan belli olan 'orta' program (Discord) ortalanır", function () {
    const o = new Ortam(); const w = o.ac({ sinif: "", dosya: "" }); o.otur(); esit(o.yer(w), "tam", "kimliksiz pencere");
    w.pSinif("discord"); o.otur(); esit(w.maximizeMode, 0, "büyük kaldı"); bekle(o.ortada(w), "ortada değil"); esit(w._geo.width, Math.round(1920 * 0.58), "en");
});
senaryo("yalnızca .desktop kimliği sonradan gelirse de kural uygulanır (Java/XWayland programları)", function () {
    const o = new Ortam(); const w = o.ac({ sinif: "java-lang-thread", dosya: "" }); const t = o.ac(KON); o.otur(); esit(o.yer(w), "sag", "kimliksiz");
    w.pDosya("jetbrains-studio"); o.otur(); esit(o.yer(w), "tam", "studio"); esit(o.yer(t), "sol", "konsole");
});
senaryo("etkinlikler: ayrı etkinliklerdeki pencereler birbirini saymaz; hepsinde görünen pencereye dokunulmaz", function () {
    const o = new Ortam({ etkinlikler: ["A", "B"] }); const a = o.ac({ sinif: "a", etkinlik: "A" }); const b = o.ac({ sinif: "b", etkinlik: "B" });
    const hep = o.ac({ sinif: "c", etkinlikler: [] }); o.otur();
    esit(o.yer(a), "tam", "a"); esit(o.yer(b), "tam", "b"); esit(hep.betikIslem, 0, "her etkinlikte görünen pencereye dokunuldu");
    b.kEtkinlik(["A"]); o.otur(); esit(o.yer(a), "sol", "a"); esit(o.yer(b), "sag", "b aynı etkinliğe gelince");
});
senaryo("tek etkinlik varken etkinlik bilgisi hiçbir şeyi değiştirmez", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a", etkinlikler: ["ana"] }); const b = o.ac({ sinif: "b", etkinlikler: [] }); o.otur();
    esit(o.yer(a), "sol", "a"); esit(o.yer(b), "sag", "b");
});
senaryo("birden çok masaüstünde görünen pencere sayılmaz, dokunulmaz", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ masaustleri: [o.masaustleri[0], o.masaustleri[1]] }, FF));
    const t = o.ac(Object.assign({ masaustu: o.masaustleri[1] }, KON)); o.otur();
    esit(f.betikIslem, 0, "firefox"); esit(o.yer(t), "tam", "konsole tek sayılmalı");
    f.desktops = [o.masaustleri[1]]; f.desktopsChanged.emit(); o.otur(); esit(o.yer(f), "sag", "tek masaüstüne dönünce"); esit(o.yer(t), "sol", "konsole");
});
senaryo("kural değişince yalnızca kuralı değişen programın pencereleri yeniden yerleşir", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); const d = o.ac(DIS); o.otur();
    const once = [f, t, d].map(function (w) { return w.betikIslem; });
    let k = JSON.parse(JSON.stringify(TEST_KURALLARI)); k.k.splice(1, 0, ["=yeni.program", "tam"]); k.k.push(["=baska", "sol"]); k.h.push("=oyun");
    o.ayarDegistir("Kurallar", JSON.stringify(k)); o.otur();
    [f, t, d].forEach(function (w, i) { esit(w.betikIslem, once[i], "ilgisiz kural değişiminde dokunuldu: " + w.resourceClass); });
    k = JSON.parse(JSON.stringify(k)); k.k[0] = ["firefox", "tam"]; o.ayarDegistir("Kurallar", JSON.stringify(k)); o.otur();
    esit(o.yer(f), "tam", "firefox yeni kural"); esit(o.yer(t), "sol", "konsole"); esit(d.betikIslem, once[2], "discord'a dokunuldu");
});
senaryo("'orta' kuralı sonradan verilen program yeni açılmış gibi ortalanır; elle yerleştirilmişse dokunulmaz", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); o.otur(); b.kBuyut(); o.otur();
    const k = JSON.parse(JSON.stringify(TEST_KURALLARI)); k.k.push(["=a", "orta"], ["=b", "orta"]); o.ayarDegistir("Kurallar", JSON.stringify(k)); o.otur();
    bekle(o.ortada(a), "a ortalanmadı"); esit(o.yer(b), "tam", "elle büyütülmüş b");
});
senaryo("yeniden yükleme (devirli): elle işaretleri, kurala uygun yerde duran pencerede bile korunur", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur(); f.kYasla("sag"); o.otur(); bekle(o.kayit(f).elle, "ön koşul");
    const once = [f.betikIslem, t.betikIslem]; o.betikYukle(true); o.otur();
    bekle(o.kayit(f).elle, "elle işareti yeniden yüklemede kayboldu"); esit(f.betikIslem, once[0], "firefox"); esit(t.betikIslem, once[1], "konsole");
    o.kapat(t); o.otur(); esit(o.yer(f), "sag", "elle yaslanmış firefox büyütüldü");
});
senaryo("yeniden yükleme (devirli): seçilmiş yarılar, yardımcılar ve açılış sırası korunur", function () {
    const o = new Ortam(); const a = o.ac({ sinif: "a" }); const b = o.ac({ sinif: "b" }); const c = o.ac({ sinif: "c" }); o.otur();
    const y = o.ac({ sinif: "bilinmeyen", geo: KUCUK }); o.otur(); y.kTasi({ x: 10, y: 10, width: 500, height: 300 }); o.otur();
    const yerler = [a, b, c].map(function (w) { return o.yer(w); }); const islem = o.pencereler.map(function (w) { return w.betikIslem; });
    o.pencereler.reverse();                             // KWin'in pencere listesi açılış sırasında olmayabilir
    o.betikYukle(true); o.otur(); o.ac({ sinif: "d" }); o.otur();
    [a, b, c].forEach(function (w, i) { esit(o.yer(w), yerler[i], "yer değişti: " + w.resourceClass); });
    bekle(o.kayit(y).yardimci && o.kayit(y).elle, "yardımcı/elle bilgisi kayboldu"); esit(y._geo.x, 10, "elle taşınan yardımcı");
    esit(o.kayit(a).sira < o.kayit(b).sira && o.kayit(b).sira < o.kayit(c).sira, true, "açılış sırası");
});
senaryo("yeniden yükleme: eski (süresi geçmiş) bir devir kaydı kalmışsa kullanılmaz", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur(); o.betikYukle(true); o.otur();
    f.kTasi({ x: 100, y: 100, width: 900, height: 700 }); o.otur(); bekle(o.kayit(f).elle, "ön koşul"); o.ilerle(20000);
    const once = f.betikIslem; o.betikYukle(false, true); o.otur(); o.otur();
    esit(f.betikIslem, once, "eski devire güvenilip elle taşınan pencere oynatıldı"); bekle(o.kayit(f).elle, "elle sayılmadı");
});
senaryo("yeniden yükleme (devirsiz): betiğin kendi koymayacağı bir düzen de olduğu gibi kalır", function () {
    const o = new Ortam(); const f = o.ac(FF); const t = o.ac(KON); o.otur(); t.kTasi({ x: 1100, y: 100, width: 600, height: 700 }); o.otur();
    f.maximizeMode = 0; f._istenen = 0; f._geo = { x: 960, y: 0, width: 960, height: 1080 };       // başka bir araç sağa koymuş
    const once = [f.betikIslem, t.betikIslem]; o.betikYukle(); o.otur(); o.otur();
    esit(f.betikIslem, once[0], "firefox oynatıldı"); esit(t.betikIslem, once[1], "konsole oynatıldı"); esit(f._geo.x, 960, "firefox yeri");
});
senaryo("yeniden yüklemede bağlı ve yardımcı pencereler yerinden oynamaz, sonra izlemeye devam eder", function () {
    const o = new Ortam(); const f = o.ac(Object.assign({ pid: 77 }, FF)); const t = o.ac(KON); o.otur();
    const c = o.ac({ sinif: "x", ana: f, kaydir: { x: 80, y: 40 } }); const y = o.ac(Object.assign({ pid: 77, geo: KUCUK }, FF)); o.otur();
    const once = [c.betikIslem, y.betikIslem]; o.betikYukle(true); o.otur(); esit(c.betikIslem, once[0], "bağlı"); esit(y.betikIslem, once[1], "yardımcı");
    o.kapat(t); o.otur(); o.otur(); bekle(o.ortada(y, f._geo), "yardımcı izlemedi"); esit(c._geo.x + 150, f._geo.x + f._geo.width / 2 + 80, "bağlı pencerenin uzaklığı");
});
senaryo("saçma oranlı kural (eksi, 4 kat) yok sayılır; '~' içinde arar; 'genel' kuralsız demektir", function () {
    const o = new Ortam({ kurallar: { k: [["=muaf", "genel"], ["~uaf", "tam"], ["test", "orta", -1, 4], ["~blimetex", "sag-hep"]], h: [] } });
    const w = o.ac({ sinif: "test" }); o.otur(); esit(w._geo.width, Math.round(1920 * 0.58), "en"); esit(w._geo.height, Math.round(1080 * 0.70), "boy");
    const s = o.ac({ sinif: "com.sublimehq.sublimetext" }); o.otur(); esit(o.yer(s), "sag", "'~' deseni");
    const m = o.ac({ sinif: "muaf" }); const z = o.ac({ sinif: "zuaf" }); o.otur(); esit(o.ic.kural(m), "", "genel"); esit(o.ic.kural(z), "tam", "içinde");
});
senaryo("durum raporu bağlı pencereyi ve sayılmama nedenini gösterir", function () {
    const o = new Ortam(); const f = o.ac(FF); o.ac({ sinif: "x", ana: f }); o.ac({ sinif: "y", ustte: true }); o.otur();
    o.ayarDegistir("RaporIste", "r"); const m = String(o.dbus[o.dbus.length - 1][4]);
    bekle(m.indexOf("HAYIR(bagli,izliyor)") !== -1 && m.indexOf("HAYIR(ustte)") !== -1 && m.indexOf("surum=3") !== -1, "rapor eksik: " + m);
});

// ── 2. Rastgele olaylar ────────────────────────────────────────────────────────────────────────
console.log("2. Rastgele olaylar");

function degismezler(o, dokunulmaz, adim, uzaklik) {
    hatasiz(o);
    const gruplar = new Map();
    for (const w of o.pencereler) {
        const d = o.kayit(w);
        if (!o.ic.ilgili(w)) { continue; }
        if (w.minimized || d.yardimci || o.ic.kural(w) === "orta") { continue; }
        const k = o.ekranlar.indexOf(w.output) + ":" + o.masaustleri.indexOf(w.desktops[0]);
        if (!gruplar.has(k)) { gruplar.set(k, []); }
        gruplar.get(k).push(w);
    }
    for (const liste of gruplar.values()) {
        const yarilar = { sol: 0, sag: 0 };
        let oynatilabilir = 0;
        for (const w of liste) {
            const d = o.kayit(w);
            if (d.elle || w.fullScreen) { continue; }
            const y = o.yer(w);
            bekle(["tam", "sol", "sag"].includes(y), adim + ": yönetilen pencere yerinde değil (" + w.resourceClass + " → " + y + ")");
            if (liste.length === 1 && !["sag-hep", "sol-hep"].includes(o.ic.kural(w))) { esit(y, "tam", adim + ": tek pencere"); }
            if (o.ic.kural(w) === "tam") { esit(y, "tam", adim + ": tam kurallı"); }
            if (y === "sol" || y === "sag") { yarilar[y]++; oynatilabilir++; }
        }
        // çakışma kuralı: oynatılabilir yarım pencerelerin hepsi bir yarıda ve öbür yarı tamamen boş olamaz
        let digerDolu = { sol: false, sag: false };
        for (const w of liste) {
            const d = o.kayit(w);
            if ((d.elle || w.fullScreen) && w.maximizeMode !== 3 && !w.fullScreen) {
                const a = o.alan(w), g = w._geo;
                if (g.width <= a.width * 0.75) { digerDolu[(g.x + g.width / 2) < (a.x + a.width / 2) ? "sol" : "sag"] = true; }
            }
        }
        if (oynatilabilir >= 2) {
            bekle(!(yarilar.sol === 0 && !digerDolu.sol && yarilar.sag >= 2), adim + ": sol yarı boşken sağda yığılma");
            bekle(!(yarilar.sag === 0 && !digerDolu.sag && yarilar.sol >= 2), adim + ": sağ yarı boşken solda yığılma");
        }
    }
    // bağlı pencereler ana pencereye, açıldıkları andaki uzaklıkta mı duruyor
    for (const c of o.pencereler) {
        const p = c.transientFor, d = o.kayit(c), u = uzaklik.get(c);
        if (!u || !p || p.deleted || !d || d.elle || c.minimized || c.fullScreen || c.maximizeMode !== 0) { continue; }
        if (p.minimized || p.output !== c.output || p.desktops.indexOf(c.desktops[0]) === -1) { continue; }
        const pd = o.kayit(p); if (!pd || pd.haric || d.haric) { continue; }
        const a = o.alan(c), g = c._geo, pg = p._geo;
        const hx = Math.round(pg.x + pg.width / 2 + u.x - g.width / 2), hy = Math.round(pg.y + pg.height / 2 + u.y - g.height / 2);
        const x = Math.max(a.x, Math.min(hx, a.x + a.width - g.width)), y = Math.max(a.y, Math.min(hy, a.y + a.height - g.height));
        // tam uzaklığında (ekrandan taşsa da) ya da ekrana sığdırılmış yerinde olmalı
        bekle((Math.abs(g.x - hx) <= 2 && Math.abs(g.y - hy) <= 2) || (Math.abs(g.x - x) <= 2 && Math.abs(g.y - y) <= 2), adim + ": bağlı pencere ana pencereyi izlemedi (" + c.resourceClass + " " + g.x + "," + g.y + " beklenen " + x + "," + y + ")");
    }
    // dokunulmaması gerekenlere dokunulmadı mı
    for (const [w, islem] of dokunulmaz) {
        if (w.deleted) { dokunulmaz.delete(w); continue; }
        // tek istisna: yalnızken tam duran elle pencere yanına yeni pencere gelince bırakılır
        const dw = o.kayit(w);
        if (dw && !dw.elle && dw.yalnizdanCozuldu) { dokunulmaz.delete(w); continue; }
        esit(w.betikIslem, islem, adim + ": dokunulmaması gereken pencereye dokunuldu (" + w.resourceClass + ")");
    }
}

function rastgeleKosu(tohum, adimSayisi, gecikme) {
    const o = new Ortam({ tohum: tohum, gecikme: gecikme, ekran: tohum % 3 === 0 ? 2 : 1 });
    const r = rastgeleUret(tohum * 7919 + 1);
    const sec = function (liste) { return liste[Math.floor(r() * liste.length)]; };
    const siniflar = ["org.mozilla.firefox", "org.kde.konsole", "org.kde.kate", "sublime_text", "jetbrains-studio", "discord",
        "Eclipse", "org.kde.okular", "a", "b", "c", "vlc", "org.freedesktop.impl.portal.desktop.kde"];
    const dokunulmaz = new Map();                       // elle yerleştirilmiş pencere → o andaki işlem sayısı
    const uzaklik = new Map();                          // bağlı pencere → ana pencere merkezine beklenen uzaklık
    const izlenebilir = function (c) { const p = c.transientFor; return p && !p.deleted && !p.minimized && p.output === c.output && p.desktops.indexOf(c.desktops[0]) !== -1; };
    const gunluk = [];
    const IZ = process.env.TRS_IZ ? 1000 : 10;
    for (let i = 0; i < adimSayisi; i++) {
      try {
        const acik = o.pencereler.filter(function (w) { return w.normalWindow; });
        const zar = r();
        let ne = "";
        if (zar < 0.22 || acik.length === 0) {
            const s = sec(siniflar);
            const kucuk = r() < 0.25;
            const ekran = sec(o.ekranlar);
            const w = o.ac({ sinif: s, geo: kucuk ? Object.assign({}, KUCUK, { x: ekran.alan.x + KUCUK.x }) : undefined, pid: r() < 0.3 ? 500 : undefined, buyuk: r() < 0.1,
                masaustu: o.masaustleri[Math.floor(r() * 3)], ekran: ekran, iletisim: r() < 0.05, ustte: r() < 0.03 });
            ne = "aç " + s + (kucuk ? " (küçük)" : "");
            if (r() < 0.15) { o.ilerle(200); w.kBuyut(); ne += " + kendini büyüttü"; }
        } else if (zar < 0.36) { const w = sec(acik); o.kapat(w); dokunulmaz.delete(w); ne = "kapat " + w.resourceClass; }
        else if (zar < 0.44) { const w = sec(acik); o.ilerle(2000); const degisir = w._istenen !== 3; w.kBuyut(); ne = "elle büyüt " + w.resourceClass; if (degisir && o.ic.ilgili(w)) { o.otur(); bekle(o.kayit(w).elle, "tohum " + tohum + " adım " + i + ": büyütme elle sayılmadı"); dokunulmaz.set(w, w.betikIslem); } }
        else if (zar < 0.46) {                           // sürükle; bırakmadan önce başka şeyler olsun
            const w = sec(acik); o.ilerle(2000); w.kTut(); w.kSurukle({ x: w.output.alan.x + 60 + Math.floor(r() * 500), y: 60 + Math.floor(r() * 300), width: 641 + i, height: 480 });
            const once = w.betikIslem; const yeni = o.ac({ sinif: sec(siniflar) }); o.ilerle(300); if (r() < 0.5) { o.kapat(yeni); } o.ilerle(1500);
            esit(w.betikIslem, once, "tohum " + tohum + " adım " + i + ": sürüklenen pencereye dokunuldu (" + w.resourceClass + ")");
            w.kBirak(); ne = "sürükle " + w.resourceClass; if (o.ic.ilgili(w)) { o.otur(); bekle(o.kayit(w).elle, "sürükleme elle sayılmadı"); dokunulmaz.set(w, w.betikIslem); }
        }
        else if (zar < 0.54) { const w = sec(acik); o.ilerle(2000); w.kTasi({ x: w.output.alan.x + 50 + Math.floor(r() * 600), y: 40 + Math.floor(r() * 300), width: 500 + Math.floor(r() * 700), height: 300 + Math.floor(r() * 500) }); ne = "taşı " + w.resourceClass; if (o.ic.ilgili(w)) { o.otur(); dokunulmaz.set(w, w.betikIslem); } }
        else if (zar < 0.60) { const w = sec(acik); o.ilerle(2000); w.kYasla(r() < 0.5 ? "sol" : "sag"); ne = "yasla " + w.resourceClass; if (o.ic.ilgili(w)) { o.otur(); dokunulmaz.set(w, w.betikIslem); } }
        else if (zar < 0.68) { const w = sec(acik); w.kSimge(!w.minimized); ne = "simge " + w.resourceClass; }
        else if (zar < 0.74) { const w = sec(acik); w.kTamEkran(!w.fullScreen); ne = "tam ekran " + w.resourceClass; }
        else if (zar < 0.82) { const w = sec(acik); if (!w.onAllDesktops) { w.kMasaustu(o.masaustleri[Math.floor(r() * 3)]); ne = "masaüstü " + w.resourceClass; } }
        else if (zar < 0.86) { for (let j = 0; j < 5; j++) { o.ipucu(); o.ilerle(20); } ne = "ipuçları"; }
        else if (zar < 0.89) { const ana = sec(acik); if (!ana.minimized) { const c = o.ac({ sinif: ana.resourceClass, ana: ana, iletisim: r() < 0.3 }); uzaklik.set(c, { x: 0, y: 0 }); ne = "bağlı pencere aç (" + ana.resourceClass + ")"; } }
        else if (zar < 0.91) {                           // yeniden yükle: oturmuş düzende hiçbir pencere oynamamalı
            o.otur(); o.otur(); const devirli = r() < 0.6; const once = o.pencereler.map(function (w) { return w.betikIslem; });
            for (const w of Array.from(dokunulmaz.keys())) {   // yalnızlıktan bırakılan iz devirle taşınmaz
                const dw = o.kayit(w); if (dw && !dw.elle && dw.yalnizdanCozuldu) { dokunulmaz.delete(w); }
            }
            o.betikYukle(devirli); o.otur(); o.otur(); ne = "yeniden yükle" + (devirli ? " (devirli)" : "");
            o.pencereler.forEach(function (w, j) { esit(w.betikIslem, once[j], "tohum " + tohum + " adım " + i + ": yeniden yüklemede dokunuldu (" + w.resourceClass + ")"); });
            if (!devirli) { dokunulmaz.clear(); }       // devir yoksa kurala uygun duranlar yeniden yönetilir
            for (const c of o.pencereler) {             // bağlı pencereler oldukları yerde kalır, oradan izlemeye devam eder
                if (!c.transientFor || o.kayit(c).elle) { continue; }
                if (izlenebilir(c)) { const g = c._geo, pg = c.transientFor._geo; uzaklik.set(c, { x: g.x + g.width / 2 - pg.x - pg.width / 2, y: g.y + g.height / 2 - pg.y - pg.height / 2 }); } else { uzaklik.delete(c); }
            }
        }
        else if (zar < 0.92) { const k = JSON.parse(JSON.stringify(TEST_KURALLARI)); k.k.push(["=eklenen" + i, "tam"]); o.ayarDegistir("Kurallar", JSON.stringify(k)); ne = "ilgisiz kural ekle"; }
        else if (zar < 0.94) { o.ayarDegistir("RaporIste", "r" + i); ne = "rapor"; }
        else if (zar < 0.97 && o.ekranlar.length > 1) { const w = sec(acik); const e = sec(o.ekranlar); if (e !== w.output) { w.kEkran(e); dokunulmaz.delete(w); ne = "ekran " + w.resourceClass; } }
        else { o.ilerle(Math.floor(r() * 400)); ne = "bekle"; }
        gunluk.push(ne);
        if (r() < 0.5) { o.ilerle(Math.floor(r() * 200)); continue; }    // bazen oturmadan sonraki olaya geç
        o.otur(); o.otur();
        degismezler(o, dokunulmaz, "tohum " + tohum + " adım " + i, uzaklik);
      } catch (hata) {
            hata.message += "\n          son olaylar: " + gunluk.slice(-IZ).join(" · ");
            hata.message += "\n          pencereler: " + o.pencereler.filter(function (w) { return w.normalWindow; }).map(function (w) {
                const d = o.kayit(w) || {};
                return w.resourceClass + "[m" + (o.masaustleri.indexOf(w.desktops[0]) + 1) + "e" + o.ekranlar.indexOf(w.output) + " " + o.yer(w)
                    + (o.ic.ilgili(w) ? "" : " ilgisiz(" + o.ic.neden(w) + ")") + (d.elle ? " elle" : "") + (w.transientFor ? " ana=" + w.transientFor.resourceClass : "") + (d.yardimci ? " yardimci" : "") + (d.taraf ? " taraf=" + d.taraf : "")
                    + " istek=" + d.istek + " deneme=" + d.deneme + "]";
            }).join(" ");
            hata.message += "\n          tohum " + tohum + " adım " + i + " gecikme " + gecikme;
            throw hata;
      }
    }
    return o.ic.sayaclar;
}

let toplamAdim = 0;
for (const gecikme of [0, 60, 400]) {
    senaryo("rastgele olaylar, pencere yanıt gecikmesi " + gecikme + " ms (150 koşu x 120 adım)", function () {
        for (let t = 1; t <= 150; t++) { rastgeleKosu(TOHUM * 31 + t + gecikme, 120, gecikme); toplamAdim += 120; }
    });
}

// ── 3. Canlı kurallar ──────────────────────────────────────────────────────────────────────────
console.log("3. Canlı kurallar");
const KURAL_DOSYASI = path.join(os.homedir(), ".config/trs/dizen-kurallar.json");
if (fs.existsSync(KURAL_DOSYASI)) {
    const dosya = JSON.parse(fs.readFileSync(KURAL_DOSYASI, "utf8"));
    let canli = null;
    senaryo("kural dosyası betiğin okuyacağı biçime çevrilebiliyor", function () {
        canli = JSON.parse(execFileSync("python3", [path.join(__dirname, "dizen.py"), "kurallar-json"], { encoding: "utf8" }));
        bekle(Array.isArray(canli.k) && canli.k.length >= dosya.kullanici.length, "kural sayısı eksik");
    });
    senaryo("her kurulu program, penceresi kendini nasıl tanıtırsa tanıtsın aynı kurala gidiyor (betik ile araç aynı sonucu veriyor)", function () {
        const denetim = JSON.parse(execFileSync("python3", [path.join(__dirname, "dizen.py"), "denetim-json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
        bekle(denetim.length === Object.keys(dosya.programlar).length, "program sayısı tutmuyor");
        const o = new Ortam({ kurallar: canli });
        const sapma = [];
        for (const p of denetim) {
            if (p.tutarsiz) { sapma.push(p.ad + ": varyantlara göre farklı yer (" + p.cikan.join(", ") + ")"); }
            for (const v of p.varyantlar) {
                const w = o.ac({ sinif: v.sinif, dosya: v.dosya });
                const n = o.ic.neden(w);
                const cikan = n === "haric-listesi" ? "haric" : (o.ic.kural(w) || "genel");
                if (cikan !== v.cikan) { sapma.push(p.ad + " [" + v.sinif + " | " + v.dosya + "]: araç «" + v.cikan + "», betik «" + cikan + "»"); }
                o.kapat(w);
            }
        }
        bekle(sapma.length === 0, sapma.length + " sapma: " + sapma.slice(0, 6).join("; "));
    });
} else {
    console.log("  (kural dosyası yok, atlandı)");
}

// ── Sonuç ──────────────────────────────────────────────────────────────────────────────────────
console.log("");
console.log((kalan.length ? "BAŞARISIZ" : "GEÇTİ") + ": " + gecen + " geçti, " + kalan.length + " kaldı" + (toplamAdim ? " · rastgele adım: " + toplamAdim : ""));
process.exit(kalan.length ? 1 : 0);
