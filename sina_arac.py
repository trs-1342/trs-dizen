#!/usr/bin/python3
"""Kural yönetimi aracının (dizen.py, envanter.py) sınaması:  python3 sina_arac.py

Geçici bir dizinde çalışır; gerçek kural dosyasına, kwinrc'ye ve bildirimlere dokunmaz
(KWin ile konuşan işlevler sahteleriyle değiştirilir).
"""
import contextlib
import copy
import io
import json
import os
import sys
import tempfile
import threading
import traceback
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import dizen      # noqa: E402
import envanter   # noqa: E402

GERCEK = {a: getattr(dizen, a) for a in ("gonder", "kwin_yaz", "kwin_oku")}
gecen, kalan = 0, []
gonderilen = []
yazilan = io.StringIO()


def cikti():
    return yazilan.getvalue().splitlines()


def sinama(ad):
    def sar(islev):
        global gecen
        with tempfile.TemporaryDirectory(prefix="trs-dizen-arac-") as gecici:
            dizen.KURALLAR = Path(gecici) / "trs/dizen-kurallar.json"
            gonderilen.clear()
            asil = {a: getattr(dizen, a) for a in ("gonder", "kwin_yaz", "kwin_oku", "sor", "bildir", "kurulu")}
            dizen.gonder = lambda okut=True: gonderilen.append(copy.deepcopy(dizen.sikistir())) or (0, 0)
            dizen.kwin_yaz = dizen.kwin_oku = dizen.bildir = lambda *a, **k: None
            yazilan.seek(0)
            yazilan.truncate()
            try:
                with contextlib.redirect_stdout(yazilan):
                    islev(Path(gecici))
                gecen += 1
                if "--ayrinti" in sys.argv:
                    print("  geçti   " + ad)
            except Exception as hata:
                kalan.append(ad)
                print("  KALDI   " + ad + "\n          " + (str(hata) or traceback.format_exc().strip().splitlines()[-1]))
            finally:
                for a, deger in asil.items():
                    setattr(dizen, a, deger)
        return islev
    return sar


def program(kimlik, ad, yer, sinif=""):
    return {"kimlik": kimlik, "ad": ad, "ara": [kimlik.lower()] + ([sinif.lower()] if sinif else []), "yer": yer, "gerekce": "sınama"}


def taban(*programlar):
    veri = {"kullanici": [{"ara": "firefox", "yer": "sag"}, {"ara": "konsole", "yer": "sol"},
                          {"ara": "eclipse", "yer": "orta", "en": 0.8, "boy": 0.9}, {"ara": "kde", "yer": "sol"}],
            "programlar": {p["kimlik"]: {"ad": p["ad"], "ara": p["ara"], "yer": p["yer"], "neden": "oneri"} for p in programlar},
            "haric": ["plasmashell"]}
    dizen.kaydet(veri)
    return veri


def yer(sinif, dosya=None):
    return dizen.etkin(dizen.sikistir(), sinif, sinif if dosya is None else dosya)


print("Kural yönetimi aracı")


@sinama("ayarla: elle yazılmış kural programı yakalıyorsa o kural güncellenir (eskiden etkisiz kalıyordu)")
def _(g):
    taban(program("org.mozilla.firefox", "Firefox", "sag"))
    dizen.ayarla("firefox", "sol")
    assert yer("org.mozilla.firefox") == "sol", yer("org.mozilla.firefox")
    assert dizen.yukle()["kullanici"][0] == {"ara": "firefox", "yer": "sol"}


@sinama("ayarla: kural başka programları da kapsıyorsa ona dokunulmaz, önüne programa özel kural eklenir")
def _(g):
    taban(program("org.kde.kate", "Kate", "sol"), program("org.kde.dolphin", "Dolphin", "sol"))
    dizen.ayarla("Kate", "tam")
    assert yer("org.kde.kate") == "tam" and yer("org.kde.dolphin") == "sol", (yer("org.kde.kate"), yer("org.kde.dolphin"))
    assert {"ara": "kde", "yer": "sol"} in dizen.yukle()["kullanici"]


@sinama("ayarla: 'genel' ve 'haric' de elle yazılmış kuralı aşar; oran yalnızca 'orta'da kalır")
def _(g):
    taban(program("epp.package.java", "Eclipse", "tam", "Eclipse"), program("org.mozilla.firefox", "Firefox", "sag"))
    assert yer("Eclipse", "") == "orta"
    dizen.ayarla("Eclipse", "sag")
    assert yer("Eclipse", "") == "sag" and "en" not in dizen.yukle()["kullanici"][2]
    dizen.ayarla("Eclipse", "genel")
    assert yer("Eclipse", "") == "genel" and yer("epp.package.java") == "genel"
    dizen.ayarla("Firefox", "haric")
    assert yer("org.mozilla.firefox") == "haric"
    assert not [n for n in cikti() if "UYARI" in n], "gereksiz uyarı: " + str(cikti())


@sinama("ayarla: bulunamayan ya da birden çok eşleşen ad dosyayı değiştirmez")
def _(g):
    taban(program("org.kde.kate", "Kate", "sol"), program("org.kde.katepart", "Kate Part", "sol"))
    once = dizen.KURALLAR.read_text()
    for ad in ("yokboyle", "kat"):
        try:
            dizen.ayarla(ad, "tam")
            raise AssertionError("hata vermedi: " + ad)
        except dizen.Hata:
            pass
    assert dizen.KURALLAR.read_text() == once
    dizen.ayarla("kate", "tam")                        # tam ad eşleşmesi belirsizliği çözer
    assert dizen.yukle()["programlar"]["org.kde.kate"]["yer"] == "tam"


@sinama("bozuk kural dosyası: anlaşılır hata, dosyaya dokunulmaz")
def _(g):
    dizen.KURALLAR.parent.mkdir(parents=True)
    for bozuk in ("{", '{"kullanici": [], "programlar": {}}', '{"kullanici": [{"ara": "x", "yer": "yukari"}], "programlar": {}, "haric": []}',
                  '{"kullanici": [{"ara": "x", "yer": "orta", "en": 4}], "programlar": {}, "haric": []}'):
        dizen.KURALLAR.write_text(bozuk)
        for islem in (dizen.yukle, lambda: dizen.ayarla("x", "tam"), lambda: dizen.yeni(True), dizen.sikistir):
            try:
                islem()
                raise AssertionError("hata vermedi: " + bozuk)
            except dizen.Hata as hata:
                assert "bozuk" in str(hata)
        assert dizen.KURALLAR.read_text() == bozuk, "bozuk dosyanın üstüne yazıldı"


@sinama("kural dosyası yokken varsayılanlar dosya seçici (portal) kurallarını da içerir")
def _(g):
    k = dizen.sikistir()["k"]
    assert ["org.freedesktop.impl.portal", "yardimci"] in k and ["~sublime", "sag-hep"] in k


@sinama("yeni: öneri beklemeden hemen uygulanır; dört programın dördü de kaydedilir, üçü sorulur")
def _(g):
    taban()
    dizen.kurulu = lambda: {str(i): program(str(i), "P" + str(i), "tam") for i in range(4)}
    sorulan = []

    def sor(p):
        # soru sorulduğu anda kayıt çoktan yapılmış ve betiğe iletilmiş olmalı
        assert set(dizen.yukle()["programlar"]) == {"0", "1", "2", "3"}, "soru beklenirken kayıt yapılmamış"
        assert gonderilen, "soru beklenirken kurallar iletilmemiş"
        sorulan.append(p["ad"])
        return "sol" if p["ad"] == "P1" else None
    dizen.sor = sor
    assert dizen.yeni() == (4, 0)
    v = dizen.yukle()["programlar"]
    assert sorted(sorulan) == ["P0", "P1", "P2"], sorulan
    assert v["1"]["yer"] == "sol" and v["1"]["neden"] == "secim" and v["0"]["yer"] == "tam" and v["3"]["neden"] == "oneri"
    assert dizen.etkin(gonderilen[-1], "1", "1") == "sol", "seçim betiğe iletilmedi"


@sinama("yeni: soru beklenirken yapılan başka değişiklik kaybolmaz (eskiden eski dosya geri yazılıyordu)")
def _(g):
    taban(program("old", "Old", "sol"))
    dizen.kurulu = lambda: {"old": program("old", "Old", "sol"), "new": program("new", "New", "tam")}

    def sor(p):
        dizen.ayarla("Old", "sag")                     # kullanıcı o sırada başka bir programı ayarlıyor
        return "orta"
    dizen.sor = sor
    dizen.yeni()
    v = dizen.yukle()["programlar"]
    assert v["old"]["yer"] == "sag", "araya giren değişiklik kayboldu"
    assert v["new"]["yer"] == "orta"


@sinama("yeni: soru beklenirken elle ayarlanan programın seçimi bildirim yanıtıyla ezilmez")
def _(g):
    taban()
    dizen.kurulu = lambda: {"new": program("new", "New", "tam")}

    def sor(p):
        dizen.ayarla("New", "sag")
        return "orta"
    dizen.sor = sor
    dizen.yeni()
    assert dizen.yukle()["programlar"]["new"]["yer"] == "sag"


@sinama("yeni: soru beklenirken kurulan program da aynı çalışmada yakalanır; iki tarama aynı anda çalışmaz")
def _(g):
    taban()
    kurulanlar = {"a": program("a", "A", "tam")}
    dizen.kurulu = lambda: dict(kurulanlar)
    ikinci = []

    def sor(p):
        if p["ad"] == "A":
            kurulanlar["b"] = program("b", "B", "sol")
            ikinci.append(dizen.yeni())                # aynı anda ikinci tarama: sormadan çıkmalı
        return None
    dizen.sor = sor
    assert dizen.yeni() == (2, 0)
    assert ikinci == [None] and set(dizen.yukle()["programlar"]) == {"a", "b"}


@sinama("yeni: kaldırılan program düşülür, ama senin seçtiğin/ayarladığın kayıt silinmez")
def _(g):
    v = taban(program("a", "A", "tam"), program("b", "B", "tam"), program("c", "C", "tam"))
    v["programlar"]["b"]["neden"] = "secim"
    v["programlar"]["c"]["neden"] = "elle"
    dizen.kaydet(v)
    dizen.kurulu = lambda: {}
    assert dizen.yeni(True) == (0, 1)
    assert set(dizen.yukle()["programlar"]) == {"b", "c"}


@sinama("eşzamanlı yazma: on iş parçacığı aynı anda değiştirir, hiçbiri kaybolmaz")
def _(g):
    taban()

    def ekle(i):
        dizen.degistir(lambda veri: veri["programlar"].__setitem__("p%d" % i, {"ad": "P", "ara": ["p%d" % i], "yer": "tam"}))
    isler = [threading.Thread(target=ekle, args=(i,)) for i in range(10)]
    [t.start() for t in isler]
    [t.join() for t in isler]
    assert len(dizen.yukle()["programlar"]) == 10
    assert not list(dizen.KURALLAR.parent.glob("*.tmp")), "geçici dosya kaldı"


@sinama("KWin'e ulaşılamazsa hata gizlenmez")
def _(g):
    taban(program("org.kde.kate", "Kate", "sol"))
    calistir = type("S", (), {"returncode": 1, "stderr": "Service not found", "stdout": ""})
    asil_calistir, dizen.subprocess.run = dizen.subprocess.run, lambda *a, **k: calistir
    dizen.gonder, dizen.kwin_oku, dizen.kwin_yaz = GERCEK["gonder"], GERCEK["kwin_oku"], GERCEK["kwin_yaz"]
    try:
        for komut in (["ayarla", "kate", "tam"], ["gonder"], ["sifirla"]):
            try:
                dizen.calistir(["dizen.py"] + komut)
                raise AssertionError("hata vermedi: " + komut[0])
            except dizen.Hata:
                pass
    finally:
        dizen.subprocess.run = asil_calistir


@sinama("envanter: kullanıcıdaki gizli girdi sistemdekini örter; alt dizinler taranır; terminal programı sayılmaz")
def _(g):
    sistem, kullanici = g / "sistem", g / "kullanici"
    (sistem / "kde4").mkdir(parents=True)
    kullanici.mkdir()
    giris = "[Desktop Entry]\nType=Application\nName=%s\nExec=x\n"
    (sistem / "x.desktop").write_text(giris % "X")
    (sistem / "y.desktop").write_text(giris % "Y")
    (sistem / "t.desktop").write_text(giris % "T" + "Terminal=true\n")
    (sistem / "kde4" / "z.desktop").write_text(giris % "Z")
    (kullanici / "x.desktop").write_text("[Desktop Entry]\nHidden=true\n")
    (kullanici / "y.desktop").write_text(giris % "Y2")
    eski = envanter.DIZINLER
    envanter.DIZINLER = [sistem, kullanici, g / "olmayan"]
    try:
        bulunan = envanter.tara()
    finally:
        envanter.DIZINLER = eski
    assert sorted(bulunan) == ["kde4-z", "y"], sorted(bulunan)
    assert bulunan["y"]["ad"] == "Y2"


@sinama("gerçek kural dosyası biçimce geçerli ve hiçbir program iki ayrı kurala düşmüyor")
def _(g):
    gercek = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "trs/dizen-kurallar.json"
    if not gercek.exists():
        return
    dizen.KURALLAR = gercek
    tutarsiz = [s["ad"] for s in dizen.denetim() if s["tutarsiz"]]
    assert not tutarsiz, "tutarsız: " + ", ".join(tutarsiz)


print("")
print(("BAŞARISIZ" if kalan else "GEÇTİ") + f": {gecen} geçti, {len(kalan)} kaldı")
sys.exit(1 if kalan else 0)
