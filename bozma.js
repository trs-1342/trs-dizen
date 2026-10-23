#!/usr/bin/env node
/*
    Sınamanın sınaması:  node bozma.js [-j N]

    contents/code/main.js dosyasının kopyasını tek tek bilerek bozar ve her bozuk kopyada sina.js'i
    çalıştırır. Sınama bozukluğu YAKALAMALI (kalmalı). Yakalanmayan her bozma, eksik bir senaryo demektir.
    Asıl dosyaya dokunmaz. Yeni davranış eklerken buraya onu bozan bir satır ekle.
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const KAYNAK = path.join(__dirname, "contents/code/main.js");
const KOD = fs.readFileSync(KAYNAK, "utf8");
const ES = Math.max(1, Number(process.argv[process.argv.indexOf("-j") + 1]) || Math.min(8, os.cpus().length));

// [ne bozuluyor, aranan metin, yerine konan]
const BOZMALAR = [
    ["yalnızken tam pencere yeni gelenle bölünür", "    yalnizTamiCoz(liste);\n", ""],
    ["kalabalıkta büyütülen bölünmez (yalnızlık şartı)", "d.elle && d.sonGrupBoyu === 1 &&", "d.elle &&"],
    ["tek pencere kuralı (sag/sol tek başına tam)", 'yer.set(w, n === 1 ? "tam" : k);', "yer.set(w, k);"],
    ["çakışmada üstünlük yönü", "ustunluk(w) > ustunluk(aday)", "ustunluk(w) < ustunluk(aday)"],
    ["çakışma çözümü", "if (dolu) {", "if (false) {"],
    ["kapanış beklemesi", "planla(KAPANIS_BEKLEME);", "planla();"],
    ["bekleyen dizme öne çekilmez", "if (dizmeZamani > simdi && dizmeZamani >= istenen) {", "if (false) {"],
    ["doğrulama, bekleyen dizmeyi öne almaz", "    if (dizmeZamani > Date.now()) {\n        return;", "    if (false) {\n        return;"],
    ["sayılmayan pencere kapanınca dizilmez", "    if (yardimcilariDevret(k) || d.sayildi) {", "    if (yardimcilariDevret(k) || true) {"],
    ["aynı yarıda kalan iki pencerede önce açılan sola", "if (digerYer && !yer.has(diger) && digerYer === d.taraf) {", "if (false) {"],
    ["ölü pencere ayıklanır", "    olenleriAyikla();", ""],
    ["ana penceresi kapanan kurallı yardımcı olağan pencere olur", "            anaYap(d);\n            cevrildi = true;", "            cevrildi = false;"],
    ["yardımcı başka ana pencereye bağlanır", "            d.ana = kimlik(yeniAna);\n            if (!d.elle) {", "            if (!d.elle) {"],
    ["bağı kopan küçük kutu yarıya gerilmez", "            yardimciKararVer(w, d);\n            d.yerlesti = true;\n        }\n    }\n    planla();", "        }\n    }\n    planla();"],
    ["tam ekran pencere sayılmaya devam eder", "if (!w.resizeable && !w.fullScreen) {", "if (!w.resizeable) {"],
    ["deneme sınırı", "if (d.deneme > DENEME) {", "if (false) {"],
    ["tam ekran pencere dokunulmaz", "} else if (d.elle || w.fullScreen) {", "} else if (d.elle) {"],
    ["kendi çağrımızı elle sayma", "if (kendiCagri > 0) {\n        return;                                       // biz yapıyoruz", "if (false) {\n        return;"],
    ["açılışta programın büyütmesi", "if (Date.now() - d.dogum < DOGUM_SURE && d.dogumBuyutme < DOGUM_BUYUTME) {", "if (false) {"],
    ["açılışta ikinci büyütme elledir", "d.dogumBuyutme < DOGUM_BUYUTME) {", "true) {"],
    ["sürüklenen pencere sabit", "        if (d.tasiniyor) {\n            sabit.add(w);", "        if (false) {\n            sabit.add(w);"],
    ["sürüklenen pencere eski yerinde sayılır", "        d.yer = y;\n        if (y === \"tam\") {", "        if (y === \"tam\") {"],
    ["sürüklerken büyütme isteği yok sayılır", "if (!d || d.tasiniyor) {\n        return;                                       // sürüklerken", "if (!d) {\n        return;"],
    ["sürükleme adımı kanıttır", "d.tasimaOynadi = true;", "d.tasimaOynadi = false;"],
    ["oynatmadan bırakma elle değil", "const oynadi = d.tasimaOynadi || !once || !yakin(once, w.frameGeometry);", "const oynadi = true;"],
    ["bağlı pencereyi elle taşıma", "if (oynadi && (ilgili(w) || bagliCocuk(w))) {", "if (oynadi && ilgili(w)) {"],
    ["döşenen pencere dizmeden önce işaretlenir", "        dosenenleriIsaretle();\n        gruplar = grupla();", "        gruplar = grupla();"],
    ["döşenen pencere izlemeden önce işaretlenir", "let yenidenDiz = dosenenleriIsaretle();", "let yenidenDiz = false;"],
    ["döşemeden çıkış elle değil", "    if (dosendiMi(w)) {\n        elleYap(d);", "    if (true) {\n        elleYap(d);"],
    ["sıfırlarken döşemeyi bırak", "degistir(function () { doseyiBirak(w); });", ""],
    ["bağlı pencerenin uzaklığı açılışta öğrenilir", "        if (bagliCocuk(w)) {\n            ofsOgren(w, d);\n        }\n        return;", "        return;"],
    ["kenara dayanmış kutunun niyeti ortadır", "x: kenaraDayandi(g.x, g.width, pm.x, a.x, a.width) ? 0 : m.x - pm.x,", "x: m.x - pm.x,"],
    ["bağlı pencere ekrandan taşmaz", "x = Math.max(a.x, Math.min(x, a.x + a.width - g.width));", "x = x + 0;"],
    ["yerinde duran bağlı pencereye dokunma", "        return g;                                     // zaten orada", "        d.deneme += 0;"],
    ["simge durumundaki ana pencere izlenmez", "if (!p || p.deleted || p.minimized || p.output !== w.output) {", "if (!p || p.deleted || p.output !== w.output) {"],
    ["başka masaüstündeki ana pencere izlenmez", "if (!ayniMasaustu) {", "if (false) {"],
    ["bağlı pencere izleme", 'merkezeKoy(w, d, { x: pm.x + d.ofs.x, y: pm.y + d.ofs.y }, "bagli");', ""],
    ["bağlı pencere uzaklığı korunur", "{ x: pm.x + d.ofs.x, y: pm.y + d.ofs.y }", "{ x: pm.x, y: pm.y }"],
    ["büyüyen yardımcı ana pencere olur", "            anaYap(d);                                // küçük açılıp sonradan büyüdü: yardımcı değil\n            yenidenDiz = true;", "            yenidenDiz = false;"],
    ["büyük açılan yardımcı küçültülür", 'istekYap(w, d, "kucuk", false, function () { w.setMaximize(false, false); });', ""],
    ["yardımcı ana pencereye bağlanır", "            d.ofs = { x: 0, y: 0 };                   // ana pencerenin tam ortası; izleme geçişi taşır", ""],
    ["kuralı değişmeyen pencere yeniden değerlendirilmez", "    if (ozet === d.sonKural) {\n        return false;\n    }", "    if (false) {\n        return false;\n    }"],
    ["kuralı değişen pencere yeni açılmış sayılır", "    d.dogum = Date.now();\n    d.dogumBuyutme = 0;\n    istegiUnut(d);\n    yardimciKararVer(w, d);", "    istegiUnut(d);"],
    [".desktop kimliği sinyali", '["desktopFileNameChanged", function () { sinifDegisti(w); }],', ""],
    ["sınıf sinyali", '["windowClassChanged", function () { sinifDegisti(w); }],', ""],
    ["devralmada yineleme", "for (let tur = 0; tur <= bilinmeyen.size; tur++) {", "for (let tur = 0; tur < 1; tur++) {"],
    ["devralmada uymayan elle sayılır", "                if (durduguYer(w) !== y) {\n                    d.elle = true;", "                if (false) {\n                    d.elle = true;"],
    ["devirde elle işareti", "            d.elle = v.elle;", "            d.elle = false;"],
    ["devirde yardımcı bilgisi", '            d.yardimci = v.yardimci === "k" || v.yardimci === "o";', "            d.yardimci = false;"],
    ["devirde açılış sırası", "            d.sira = v.sira;", ""],
    ["eski devir kullanılmaz", "if (ayrac === -1 || !(yas >= -DEVIR_OMRU && yas <= DEVIR_OMRU)) {", "if (ayrac === -1) {"],
    ["yeniden yüklemede yardımcı yeniden ortalanmaz", "        d.yerlesti = true;                            // yardımcılar yeniden ortalanmaz", ""],
    ["yeniden yüklemede açılış hoşgörüsü yok", "        d.dogum = 0;                                  // açılış süresi çoktan geçti", ""],
    ["birden çok masaüstü", "if (w.desktops.length !== 1) {", "if (w.desktops.length === 0) {"],
    ["etkinlikler", "        return !!a && a.length > 1;", "        return false;"],
    ["saçma oran", "return typeof v === \"number\" && v >= 0.2 && v <= 1 ? v : undefined;", "return typeof v === \"number\" ? v : undefined;"],
    ["'genel' kuralı", 'd.kuralNo = KURALLAR[i].yer === "genel" ? -1 : i;', "d.kuralNo = i;"],
    ["'~' deseni", 'if (a.charAt(0) === "~") {', "if (false) {"],
    ["yalın sözcük parça eşleşmesi", 'tur: /[.\\- ]/.test(a) ? "icinde" : "parca"', 'tur: "icinde"'],
    ["üstte pencere sayılmaz", '    if (w.keepAbove) {\n        return "ustte";\n    }', ""],
    ["bağlı pencere sayılmaz", '    if (w.transient) {\n        return "bagli";\n    }', ""],
    ["simge durumundaki sayılmaz", "    if (!ilgili(w) || w.minimized) {\n        return false;\n    }\n    return kural(w)", "    if (!ilgili(w)) {\n        return false;\n    }\n    return kural(w)"],
    ["'orta' sayılmaz", 'return kural(w) !== "orta" && !kayit(w).yardimci;', "return !kayit(w).yardimci;"],
    ["yoldaki 'tam' isteği geri alınır", "if (w.maximizeMode !== 0 || tamYolda) {", "if (w.maximizeMode !== 0) {"],
    ["yoldaki aynı istek yinelenmez", "    if (ucusta && d.istek === ad) {\n        dogrula();\n        return;\n    }", ""],
    ["kural bozuksa eldeki kalır", "        if (KURALLAR.length === 0) {\n            kurallariKur(VARSAYILAN);\n        }", "        kurallariKur(VARSAYILAN);"],
    ["sıfırlama", "        d.elle = false;\n        d.taraf = \"\";", "        d.taraf = \"\";"],
    ["rapor yalnız istenince", '    if (istekGeldi("RaporIste")) {', "    if (true) {"]
];

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), "trs-dizen-bozma-"));
const sonuc = [];
let sira = 0;
let calisan = 0;

function birSonraki() {
    while (calisan < ES && sira < BOZMALAR.length) {
        const no = sira++;
        const [ad, ara, yeni] = BOZMALAR[no];
        const adet = KOD.split(ara).length - 1;
        if (adet !== 1) {
            sonuc[no] = { ad: ad, durum: "BULUNAMADI (" + adet + " eşleşme): bozma satırını güncelle" };
            continue;
        }
        const dosya = path.join(gecici, "main-" + no + ".js");
        fs.writeFileSync(dosya, KOD.replace(ara, yeni));
        calisan++;
        const p = spawn(process.execPath, [path.join(__dirname, "sina.js")], { env: Object.assign({}, process.env, { TRS_DIZEN_BETIK: dosya }), stdio: ["ignore", "pipe", "pipe"] });
        let cikti = "";
        p.stdout.on("data", function (d) { cikti += d; });
        p.on("close", function (kod) {
            const ilk = (cikti.match(/KALDI\s+(.*)/) || [])[1] || "";
            sonuc[no] = { ad: ad, durum: kod === 0 ? "YAKALANMADI" : "yakalandı", ilk: ilk };
            calisan--;
            birSonraki();
        });
    }
    if (calisan === 0 && sira >= BOZMALAR.length) {
        let kacan = 0;
        sonuc.forEach(function (s) {
            if (s.durum !== "yakalandı") { kacan++; }
            if (s.durum !== "yakalandı" || process.argv.includes("--ayrinti")) {
                console.log("  " + s.durum.padEnd(12) + s.ad + (s.ilk ? "   ← " + s.ilk.substring(0, 90) : ""));
            }
        });
        fs.rmSync(gecici, { recursive: true, force: true });
        console.log((kacan ? "EKSİK" : "TAMAM") + ": " + (sonuc.length - kacan) + "/" + sonuc.length + " bozma yakalandı");
        process.exit(kacan ? 1 : 0);
    }
}
birSonraki();
