#!/usr/bin/python3
"""TRS Dizen kural yönetimi.

  dizen.py gonder               kural dosyasını çalışan betiğe iletir (betik yeniden yüklenmez)
  dizen.py yeniden-yukle        betiği yeniden yükler; önce eskisinden durumunu alıp yenisine devreder
  dizen.py sifirla              elle işaretlerini siler, pencereleri baştan dizer
  dizen.py durum                çalışan betikten her pencerenin durumunu alır
  dizen.py ilk                  kurulu bütün programları öneriyle kural dosyasına yazar (sormadan)
  dizen.py yeni [--sessiz]      yeni kurulan programlara öneriyi hemen uygular, sonra bildirimle sorar
  dizen.py liste [süzgeç]       programları ve yerlerini listeler
  dizen.py ayarla <ad> <yer>    bir programın yerini değiştirir (yer: tam sag sol orta haric genel)
  dizen.py denetle              kuralların tutarlılığını denetler (bir program iki ayrı kurala düşüyor mu)

Kural dosyası: ~/.config/trs/dizen-kurallar.json
  kullanici   elle yazılmış kurallar; SIRASI ÜSTÜNLÜK SIRASIDIR ve her şeyden önce gelir
  programlar  kurulu programlar: kimlik → ad, ara (tanıma adları), yer, neden (oneri | secim | elle)
  haric       hiç dokunulmayan pencereler

"durum", "sifirla" ve "yeniden-yukle" betikle kwinrc üzerinden konuşur: [Script-trsdizen] altına bir
istek anahtarı yazar ve KWin'e ayarlarını yeniden okutur. Pencerelere dokunmaz ama kwinrc'yi değiştirir.
"""
import contextlib
import fcntl
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import envanter

BURASI = Path(__file__).resolve().parent
KURALLAR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "trs/dizen-kurallar.json"
BETIK = Path.home() / ".local/share/kwin/scripts/trsdizen/contents/code/main.js"
YERLER = ("tam", "sag", "sol", "orta", "haric", "genel")                    # bir programa verilebilecek yerler
KURAL_YERLERI = ("tam", "sag", "sol", "sag-hep", "sol-hep", "orta", "yardimci", "genel")   # betiğin tanıdıkları
YER_ADI = {"tam": "tam ekran", "sag": "sağ yarı", "sol": "sol yarı", "orta": "ortada küçük",
           "haric": "hiç karışma", "genel": "genel kural", "sag-hep": "hep sağ", "sol-hep": "hep sol",
           "yardimci": "kendi boyutunda, ortada"}
SORU_SAYISI = 3          # toplu kurulumda en çok kaç program için bildirimle sorulur
SORU_SURESI = 45         # bildirimin ekranda kalma süresi (sn)

ILK_KULLANICI = [
    {"ara": "firefox", "yer": "sag"}, {"ara": "konsole", "yer": "sol"}, {"ara": "~sublime", "yer": "sag-hep"},
    {"ara": "jetbrains-studio", "yer": "tam"}, {"ara": "discord", "yer": "orta"},
    {"ara": "eclipse", "yer": "orta", "en": 0.80, "boy": 0.90},
    {"ara": "idea", "yer": "tam"}, {"ara": "codium", "yer": "tam"}, {"ara": "krita", "yer": "tam"},
    {"ara": "gimp", "yer": "tam"}, {"ara": "obsproject", "yer": "tam"}, {"ara": "obs", "yer": "tam"},
    {"ara": "virtualbox machine", "yer": "tam"}, {"ara": "boxes", "yer": "tam"}, {"ara": "gazebo", "yer": "tam"},
    {"ara": "gz", "yer": "tam"}, {"ara": "libreoffice", "yer": "tam"}, {"ara": "soffice", "yer": "tam"},
    {"ara": "onlyoffice", "yer": "tam"}, {"ara": "desktopeditors", "yer": "tam"},
    {"ara": "obsidian", "yer": "sag"}, {"ara": "okular", "yer": "sag"}, {"ara": "zeal", "yer": "sag"},
    {"ara": "dolphin", "yer": "sol"}, {"ara": "kate", "yer": "sol"},
    {"ara": "systemsettings", "yer": "orta"}, {"ara": "kcalc", "yer": "orta"}, {"ara": "ark", "yer": "orta"},
    {"ara": "spectacle", "yer": "orta"}, {"ara": "btrfs-assistant", "yer": "orta"},
    {"ara": "systemmonitor", "yer": "orta"}, {"ara": "discover", "yer": "orta"},
    {"ara": "superproductivity", "yer": "orta"}, {"ara": "productivity", "yer": "orta"}, {"ara": "chatgpt", "yer": "orta"},
    {"ara": "org.freedesktop.impl.portal", "yer": "yardimci"}, {"ara": "xdg-desktop-portal", "yer": "yardimci"},
]
ILK_HARIC = ["net.trs.pano", "ksplashqml", "plasmashell", "krunner", "kscreenlocker", "xwaylandvideobridge"]


class Hata(Exception):
    """Kullanıcıya düz metinle gösterilecek hata."""


# ── Kural dosyası ──────────────────────────────────────────────────────────────────────────────
def bicim_denetle(veri):
    """Dosyanın biçimini denetler; bozuksa neresinin bozuk olduğunu söyleyen Hata fırlatır."""
    if not isinstance(veri, dict):
        raise Hata("en dışta bir nesne { } olmalı")
    for ad, tur in (("kullanici", list), ("programlar", dict), ("haric", list)):
        if not isinstance(veri.get(ad), tur):
            raise Hata(f'"{ad}" bölümü yok ya da türü yanlış')
    for i, k in enumerate(veri["kullanici"]):
        if not isinstance(k, dict) or not isinstance(k.get("ara"), str) or not k["ara"].lstrip("=~"):
            raise Hata(f'kullanici[{i}]: "ara" yok ya da boş')
        if k.get("yer") not in KURAL_YERLERI:
            raise Hata(f'kullanici[{i}] ({k["ara"]}): "yer" şunlardan biri olmalı: {" ".join(KURAL_YERLERI)}')
        for o in ("en", "boy"):
            if o in k and not (isinstance(k[o], (int, float)) and 0.2 <= k[o] <= 1):
                raise Hata(f'kullanici[{i}] ({k["ara"]}): "{o}" 0.2 ile 1 arasında bir oran olmalı')
    for kimlik, p in veri["programlar"].items():
        if not isinstance(p, dict) or not isinstance(p.get("ad"), str) or p.get("yer") not in YERLER:
            raise Hata(f'programlar["{kimlik}"]: "ad" ya da "yer" bozuk')
        if not isinstance(p.get("ara"), list) or not p["ara"] or not all(isinstance(a, str) and a for a in p["ara"]):
            raise Hata(f'programlar["{kimlik}"]: "ara" boş olmayan bir metin listesi olmalı')
    if not all(isinstance(h, str) and h for h in veri["haric"]):
        raise Hata('"haric" yalnızca metinlerden oluşmalı')


def yukle():
    if not KURALLAR.exists():
        return {"kullanici": [dict(k) for k in ILK_KULLANICI], "programlar": {}, "haric": list(ILK_HARIC)}
    try:
        veri = json.loads(KURALLAR.read_text())
        bicim_denetle(veri)
    except (OSError, ValueError, Hata) as hata:
        raise Hata(f"kural dosyası bozuk, hiçbir şey değiştirilmedi: {KURALLAR}\n  {hata}\n"
                   f"  Düzelt ya da yedekten geri al; çalışan betik eldeki kurallarla sürüyor.") from None
    return veri


def kaydet(veri):
    bicim_denetle(veri)
    KURALLAR.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=KURALLAR.parent, prefix=".dizen-kurallar.", suffix=".tmp", delete=False) as f:
        f.write(json.dumps(veri, ensure_ascii=False, indent=1) + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(f.name, KURALLAR)


@contextlib.contextmanager
def kilit(ad, bekle=True):
    """Dosya kilidi. bekle=False iken kilit başkasındaysa None verir."""
    KURALLAR.parent.mkdir(parents=True, exist_ok=True)
    with open(KURALLAR.parent / f".dizen-{ad}.kilit", "w") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | (0 if bekle else fcntl.LOCK_NB))
        except OSError:
            yield None
            return
        yield f


def degistir(islem):
    """Dosyayı kilit altında oku → değiştir → kaydet. Aynı anda çalışan iki işlem birbirini ezmez."""
    with kilit("yazma"):
        veri = yukle()
        sonuc = islem(veri)
        kaydet(veri)
        return sonuc


def kurulu():
    programlar = envanter.tara()
    for p in programlar.values():
        p["yer"], p["gerekce"] = envanter.tahmin(p)
        p["ara"] = envanter.desenler(p)
    return programlar


# ── Eşleşme (betikteki desenYap / eslesir ile aynı kurallar) ───────────────────────────────────
def desen(ara):
    a = ara.lower()
    if a.startswith("="):
        return "tam", a[1:]
    if a.startswith("~"):
        return "icinde", a[1:]
    return ("icinde" if re.search(r"[.\- ]", a) else "parca"), a


def eslesir(ara, sinif, dosya):
    tur, a = desen(ara)
    sinif, dosya = sinif.lower(), dosya.lower()
    metin = sinif + " " + dosya
    if tur == "tam":
        return a in (sinif, dosya)
    if tur == "icinde":
        return a in metin
    return a in re.split(r"[^a-z0-9]+", metin)


def varyantlar(p, kimlik):
    """Bu programın penceresi kendini hangi (sınıf, .desktop kimliği) çiftleriyle tanıtabilir?"""
    cift = [(kimlik, kimlik)]
    for ara in p["ara"]:
        for c in ((ara, kimlik), (ara, "")):
            if c not in cift:
                cift.append(c)
    return cift


def etkin(kisa, sinif, dosya):
    """Betiğin bu pencereye uygulayacağı yer: haric | genel | tam | sag | ..."""
    if any(eslesir(h, sinif, dosya) for h in kisa["h"]):
        return "haric"
    for k in kisa["k"]:
        if eslesir(k[0], sinif, dosya):
            return k[1]
    return "genel"


def sikistir(veri=None):
    """Kural dosyasını betiğin okuduğu kısa biçime çevirir: {"k": [[ara, yer, en?, boy?], ...], "h": [...]}.

    Sıra üstünlük sırasıdır: önce elle yazılmış kurallar, sonra kurulu programlar (tam, sağ, sol, orta).
    """
    veri = veri or yukle()
    k = []
    for kural in veri["kullanici"]:
        satir = [kural["ara"].lower(), kural["yer"]]
        if "en" in kural or "boy" in kural:
            satir += [kural.get("en", 0.58), kural.get("boy", 0.70)]
        k.append(satir)
    haric = [h.lower() for h in veri["haric"]]
    for yer in ("tam", "sag", "sol", "orta"):
        for p in sorted((p for p in veri["programlar"].values() if p["yer"] == yer), key=lambda p: p["ad"].lower()):
            k += [["=" + ara.lower(), yer] for ara in p["ara"]]      # "=": sınıf ya da kimlik birebir
    for p in sorted(veri["programlar"].values(), key=lambda p: p["ad"].lower()):
        if p["yer"] == "haric":
            haric += ["=" + a.lower() for a in p["ara"] if "=" + a.lower() not in haric]
    return {"k": k, "h": haric}


def denetim(veri=None):
    """Her program için: istenen yer, her varyantta gerçekten çıkan yer. Tutarsızlar ayrıca işaretlenir."""
    veri = veri or yukle()
    kisa = sikistir(veri)
    sonuc = []
    for kimlik, p in sorted(veri["programlar"].items()):
        v = [{"sinif": s, "dosya": d, "cikan": etkin(kisa, s, d)} for s, d in varyantlar(p, kimlik)]
        cikanlar = sorted({x["cikan"] for x in v})
        sonuc.append({"kimlik": kimlik, "ad": p["ad"], "istenen": p["yer"], "varyantlar": v,
                      "tutarsiz": len(cikanlar) > 1, "cikan": cikanlar})
    return sonuc


def denetle():
    sorunlu = 0
    for s in denetim():
        if s["tutarsiz"]:
            sorunlu += 1
            print(f"TUTARSIZ  {s['ad']}: penceresi kendini nasıl tanıttığına göre farklı yere gidiyor")
            for v in s["varyantlar"]:
                print(f"            sınıf={v['sinif'] or '-':40} kimlik={v['dosya'] or '-':40} → {v['cikan']}")
        elif s["cikan"] != [s["istenen"]]:
            print(f"bilgi     {s['ad']}: listede «{YER_ADI[s['istenen']]}», elle yazılmış kural öne geçiyor → {YER_ADI.get(s['cikan'][0], s['cikan'][0])}")
    print("tutarsız program yok" if not sorunlu else f"{sorunlu} tutarsız program")
    return 1 if sorunlu else 0


# ── KWin ile konuşma ───────────────────────────────────────────────────────────────────────────
def kwin_yaz(anahtar, deger):
    r = subprocess.run(["kwriteconfig6", "--file", "kwinrc", "--group", "Script-trsdizen", "--key", anahtar, deger])
    if r.returncode != 0:
        raise Hata("kwinrc yazılamadı (kwriteconfig6)")


def kwin_oku():
    """KWin ayarları yeniden okusun: betik kuralları, sıfırlama ve rapor isteklerini o an görür."""
    try:
        r = subprocess.run(["qdbus-qt6", "org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure"],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as hata:
        raise Hata(f"KWin'e ulaşılamadı: {hata}") from None
    if r.returncode != 0:
        raise Hata("KWin'e ulaşılamadı: " + (r.stderr.strip() or "qdbus-qt6 hata verdi"))


def betik_cagir(*arg):
    return subprocess.run(["qdbus-qt6", "org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting." + arg[0], *arg[1:]],
                          capture_output=True, text=True, timeout=10)


def gonder(okut=True):
    """Kuralları çalışan betiğe iletir. Betik yeniden YÜKLENMEZ: elle yerleştirilmiş pencereler korunur."""
    kisa = sikistir()
    kwin_yaz("Kurallar", json.dumps(kisa, ensure_ascii=True, separators=(",", ":")))
    if okut:
        kwin_oku()
    return len(kisa["k"]), len(kisa["h"])


def iste(anahtar, isaret, sure=3.0):
    """Çalışan betikten bir yanıt ister (betik yanıtı D-Bus üzerinden yayar). Yanıt gelmezse None."""
    with tempfile.NamedTemporaryFile("r", suffix=".txt") as cikti:
        izleyici = subprocess.Popen(["dbus-monitor", "--session", "interface='org.freedesktop.DBus',member='GetNameOwner'"],
                                    stdout=open(cikti.name, "w"), stderr=subprocess.DEVNULL)
        try:
            time.sleep(0.4)
            kwin_yaz(anahtar, str(time.time()))
            kwin_oku()
            for _ in range(int(sure * 10)):
                time.sleep(0.1)
                bulunan = [satir for satir in open(cikti.name, errors="replace") if 'string "' + isaret in satir]
                if bulunan:
                    return bulunan[-1].split('"', 1)[1].rsplit('"', 1)[0][len(isaret):]
        finally:
            izleyici.terminate()
    return None


def durum():
    """Çalışan betikten her pencerenin durumunu ister ve okunur biçimde yazar (betik yeniden yüklenmez)."""
    govde = iste("RaporIste", "TRSDIZEN ")
    if govde is None:
        print("betikten yanıt gelmedi (yüklü değil ya da eski sürüm)")
        return 1
    parcalar = govde.split(" | ")
    print("betik: " + parcalar[0])
    for p in parcalar[1:]:
        print("  " + p)
    return 0


def yeniden_yukle():
    """Betiği yeniden yükler. Önce çalışan betikten durumunu (elle işaretleri vb.) alır, yenisine devreder."""
    if not BETIK.exists():
        raise Hata(f"betik kurulu değil: {BETIK}")
    yuklu = betik_cagir("isScriptLoaded", "trsdizen").stdout.strip() == "true"
    devir = iste("DevirIste", "TRSDIZEN-DEVIR ") if yuklu else None
    kwin_yaz("Devir", devir or "")
    kwin_oku()
    time.sleep(0.8)                                   # KWin ayarları gecikmeli okur; yeni betik Devir'i görmeli
    if yuklu:
        betik_cagir("unloadScript", "trsdizen")
    r = betik_cagir("loadScript", str(BETIK), "trsdizen")
    if r.returncode != 0:
        raise Hata("betik yüklenemedi: " + r.stderr.strip())
    r = betik_cagir("start")
    if r.returncode != 0:
        raise Hata("betik başlatılamadı: " + r.stderr.strip())
    time.sleep(0.3)
    kwin_yaz("Devir", "")                             # devir tek kullanımlıktır: başka bir yeniden yüklemede eskisi okunmasın
    return devir is not None


# ── Kurulu programlar ──────────────────────────────────────────────────────────────────────────
def ilk():
    def islem(veri):
        eklenen = 0
        for kimlik, p in kurulu().items():
            if kimlik not in veri["programlar"]:
                veri["programlar"][kimlik] = {"ad": p["ad"], "ara": p["ara"], "yer": p["yer"], "neden": "oneri", "gerekce": p["gerekce"]}
                eklenen += 1
        return eklenen, len(veri["programlar"])
    return degistir(islem)


def bildir(baslik, govde):
    subprocess.run(["notify-send", "-a", "TRS Dizen", "-i", "preferences-system-windows", baslik, govde], check=False)


def sor(p):
    """Bildirimle sor; seçim yapılmazsa None döner (öneri zaten uygulanmıştır)."""
    govde = (f"Şimdilik önerim uygulandı: {YER_ADI[p['yer']]} ({p['gerekce']}).\n"
             f"Başka bir yer istersen seç; sonradan değiştirmek için: trs-dizen ayarla")
    komut = ["notify-send", "-a", "TRS Dizen", "-i", "preferences-system-windows", "--wait", "-t", str(SORU_SURESI * 1000)]
    for yer, etiket in (("tam", "Tam ekran"), ("sag", "Sağ"), ("sol", "Sol"), ("orta", "Ortada küçük"), ("haric", "Karışma")):
        komut += ["-A", f"{yer}={etiket}"]
    komut += [f"Yeni program: {p['ad']}", govde]
    try:
        r = subprocess.run(komut, capture_output=True, text=True, timeout=SORU_SURESI + 15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    secim = r.stdout.strip()
    return secim if secim in YERLER else None


def tara_ve_uygula():
    """Yeni programları öneriyle HEMEN ekler, kaldırılanları düşer. (yeniler, silinen sayısı) döner."""
    simdi = kurulu()

    def islem(veri):
        yeniler = [p for k, p in simdi.items() if k not in veri["programlar"]]
        for p in yeniler:
            veri["programlar"][p["kimlik"]] = {"ad": p["ad"], "ara": p["ara"], "yer": p["yer"], "neden": "oneri", "gerekce": p["gerekce"]}
        # Kaldırılanlar düşülür; ama kendi seçtiğin/ayarladığın kayıt kalır: güncelleme sırasında
        # .desktop dosyası bir an yok olabilir, seçimin o yüzden silinmemeli.
        silinen = [k for k, p in veri["programlar"].items() if k not in simdi and p.get("neden") == "oneri"]
        for k in silinen:
            del veri["programlar"][k]
        return yeniler, len(silinen)
    return degistir(islem)


def secimi_yaz(p):
    secim = sor(p)
    if not secim or secim == p["yer"]:
        return

    def islem(veri):
        kayit = veri["programlar"].get(p["kimlik"])
        if kayit and kayit.get("neden") == "oneri":    # arada elle ayarlandıysa ona dokunma
            kayit["yer"], kayit["neden"] = secim, "secim"
            return True
        return False
    try:
        if degistir(islem):
            gonder()
    except Hata as hata:
        print(hata, file=sys.stderr)


def yeni(sessiz=False):
    """Yeni kurulan programlara öneriyi hemen uygular (beklemeden çalışır), sonra bildirimle sorar."""
    with kilit("yeni", bekle=False) as tutuldu:
        if tutuldu is None:
            return None                                # başka bir tarama sürüyor: iki kez sormayalım
        toplam_yeni = toplam_silinen = 0
        for _ in range(6):                             # sorular beklenirken yeni kurulum olursa onu da yakala
            yeniler, silinen = tara_ve_uygula()
            toplam_yeni += len(yeniler)
            toplam_silinen += silinen
            if yeniler or silinen:
                gonder()
            if not yeniler or sessiz:
                break
            yeniler.sort(key=lambda p: p["ad"].lower())
            sorular = [threading.Thread(target=secimi_yaz, args=(p,)) for p in yeniler[:SORU_SAYISI]]
            for s in sorular:
                s.start()
            if len(yeniler) > SORU_SAYISI:
                bildir(f"{len(yeniler)} yeni program", f"İlk {SORU_SAYISI} tanesi soruldu, hepsine öneri uygulandı. Görmek için: trs-dizen liste")
            for s in sorular:
                s.join()
        return toplam_yeni, toplam_silinen


def liste(suzgec=""):
    veri = yukle()
    kisa = sikistir(veri)
    print("Elle yazılmış kurallar (üstünlük sırasıyla; = birebir, ~ içinde geçer):")
    for k in veri["kullanici"]:
        print(f"  {k['ara']:32} {YER_ADI.get(k['yer'], k['yer'])}")
    for yer in YERLER:
        grup = sorted(((kimlik, p) for kimlik, p in veri["programlar"].items()
                       if p["yer"] == yer and suzgec.lower() in (p["ad"] + " " + kimlik).lower()),
                      key=lambda x: x[1]["ad"].lower())
        if grup:
            print(f"\n{YER_ADI[yer]} ({len(grup)}):")
        for kimlik, p in grup:
            isaret = {"secim": "seçtin", "elle": "elle", "oneri": ""}.get(p.get("neden", ""), "")
            cikan = etkin(kisa, kimlik, kimlik)
            if cikan != yer:
                isaret = (isaret + "  " if isaret else "") + "→ elle kural öne geçiyor: " + YER_ADI.get(cikan, cikan)
            print(f"  {p['ad'][:40]:40} {isaret}")


KARARLAR = {      # ad: (kwinrc anahtarı, varsayılan, en az, en çok) — betik main.js kararlariOku() ile aynı
    "dogum": ("KararDogumMs", 1500, 0, 5000),
    "kapanis": ("KararKapanisMs", 260, 0, 2000),
    "hemen": ("KararKuralHemen", 1, 0, 1),
}


def kararlar():
    cikti = {}
    for ad, (anahtar, varsayilan, _, _) in KARARLAR.items():
        r = subprocess.run(["kreadconfig6", "--file", "kwinrc", "--group", "Script-trsdizen", "--key", anahtar],
                           capture_output=True, text=True)
        m = r.stdout.strip()
        cikti[ad] = int(m) if m.lstrip("-").isdigit() else varsayilan
    return cikti


def karar_yaz(ad, deger):
    if ad not in KARARLAR or not deger.isdigit():
        raise Hata("karar: " + " ".join(KARARLAR) + " ve sayı")
    anahtar, _, en_az, en_cok = KARARLAR[ad]
    n = int(deger)
    if not en_az <= n <= en_cok:
        raise Hata(f"{ad}: {en_az}–{en_cok} arası olmalı")
    kwin_yaz(anahtar, str(n))
    kwin_oku()


def davranis():
    """Her program: kimlik, ad, kayıttaki yer, ETKİN yer (elle kural öne geçiyorsa o), neden."""
    veri = yukle()
    kisa = sikistir(veri)
    cikti = []
    for kimlik, p in veri["programlar"].items():
        cikti.append({"kimlik": kimlik, "ad": p["ad"], "yer": p["yer"], "etkin": etkin(kisa, kimlik, kimlik),
                      "neden": p.get("neden", "")})
    return {"programlar": sorted(cikti, key=lambda x: x["ad"].lower()), "haric": veri.get("haric", []),
            "yerler": {y: YER_ADI[y] for y in YERLER}}


def ayarla(ad, yer):
    if yer not in YERLER:
        raise Hata("yer şunlardan biri olmalı: " + " ".join(YERLER))

    def islem(veri):
        bulunan = [k for k, p in veri["programlar"].items() if ad.lower() in p["ad"].lower() or ad.lower() in k.lower()]
        tam = [k for k in bulunan if ad.lower() in (k.lower(), veri["programlar"][k]["ad"].lower())]
        if len(tam) == 1:
            bulunan = tam
        if len(bulunan) != 1:
            raise Hata(("bulunamadı: " + ad) if not bulunan
                       else "birden çok eşleşme: " + ", ".join(veri["programlar"][k]["ad"] for k in bulunan[:8]))
        kimlik = bulunan[0]
        p = veri["programlar"][kimlik]
        p["yer"], p["neden"] = yer, "elle"
        notlar = []
        # Elle yazılmış bir kural bu programı zaten yakalıyorsa program kaydı etkisiz kalır: onu da düzelt
        for _ in range(len(veri["kullanici"]) + 1):
            kisa = sikistir(veri)
            if all(etkin(kisa, s, d) == yer for s, d in varyantlar(p, kimlik)):
                break
            i = next((i for i, k in enumerate(veri["kullanici"])
                      if any(eslesir(k["ara"], s, d) for s, d in varyantlar(p, kimlik))), None)
            if i is None:
                break
            kural = veri["kullanici"][i]
            baskalari = [o["ad"] for ok, o in veri["programlar"].items() if ok != kimlik
                         and any(eslesir(kural["ara"], s, d) for s, d in varyantlar(o, ok))]
            if baskalari:
                # kural başka programları da kapsıyor: ona dokunma, önüne yalnız bu programa özel kural koy
                veri["kullanici"][i:i] = [{"ara": "=" + a.lower(), "yer": "genel" if yer == "haric" else yer} for a in p["ara"]]
                notlar.append(f"«{kural['ara']}» kuralı {', '.join(baskalari[:3])} için de geçerli; önüne bu programa özel kural eklendi")
                break
            if yer in ("genel", "haric"):
                del veri["kullanici"][i]
                notlar.append(f"elle yazılmış «{kural['ara']}» kuralı kaldırıldı")
            else:
                eski = kural["yer"]
                kural["yer"] = yer
                if yer != "orta":
                    kural.pop("en", None)
                    kural.pop("boy", None)
                notlar.append(f"elle yazılmış «{kural['ara']}» kuralı güncellendi ({YER_ADI.get(eski, eski)} → {YER_ADI[yer]})")
        kisa = sikistir(veri)
        kalan = sorted({etkin(kisa, s, d) for s, d in varyantlar(p, kimlik)} - {yer})
        if kalan:
            notlar.append("UYARI: bazı pencereleri hâlâ başka kurala düşüyor (" + ", ".join(kalan) + "); bak: trs-dizen denetle")
        return p["ad"], notlar

    program, notlar = degistir(islem)
    print(f"{program} → {YER_ADI[yer]}")
    for n in notlar:
        print("  " + n)


def calistir(arg):
    komut = arg[1] if len(arg) > 1 else ""
    if komut == "gonder":
        print("kurallar betiğe iletildi: %d kural, %d hariç" % gonder("--okutma" not in arg))
    elif komut == "kurallar-json":
        json.dump(sikistir(), sys.stdout, ensure_ascii=True)
    elif komut == "kararlar-json":
        json.dump(kararlar(), sys.stdout, ensure_ascii=False)
    elif komut == "karar" and len(arg) == 4:
        karar_yaz(arg[2], arg[3])
        print("karar kaydedildi")
    elif komut == "davranis-json":                # TRS Durum'un Davranış sekmesi okur
        json.dump(davranis(), sys.stdout, ensure_ascii=False)
    elif komut == "denetim-json":
        json.dump(denetim(), sys.stdout, ensure_ascii=True)
    elif komut == "denetle":
        return denetle()
    elif komut == "durum":
        return durum()
    elif komut == "yeniden-yukle":
        print("betik yeniden yüklendi" + ("; durum yenisine devredildi" if yeniden_yukle()
                                         else "; devir alınamadı, pencereler durdukları yere göre devralındı"))
    elif komut == "sifirla":
        kwin_yaz("SifirlaIste", str(time.time()))
        kwin_oku()
        print("elle işaretleri silindi, pencereler baştan dizildi")
    elif komut == "ilk":
        print("eklendi: %d, toplam: %d" % ilk())
    elif komut == "yeni":
        sonuc = yeni("--sessiz" in arg)
        print("başka bir tarama sürüyor" if sonuc is None else f"yeni: {sonuc[0]}, kaldırılan: {sonuc[1]}")
    elif komut == "liste":
        liste(arg[2] if len(arg) > 2 else "")
    elif komut == "ayarla" and len(arg) == 4:
        ayarla(arg[2], arg[3])
        gonder()
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(calistir(sys.argv))
    except Hata as hata:
        print("hata: " + str(hata), file=sys.stderr)
        sys.exit(2)
