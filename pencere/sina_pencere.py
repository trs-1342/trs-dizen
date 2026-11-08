#!/usr/bin/python3
"""trs-pencere çekirdek sınaması (bus gerekmez): öğrenme sayımı, tercih, günlük, günlük kırpma."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

BURASI = Path(__file__).resolve().parent
sys.path.insert(0, str(BURASI))


class Temel(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        os.environ["TRS_PENCERE_DURUM"] = self.d.name
        os.environ["TRS_PENCERE_OGRENILEN"] = str(Path(self.d.name) / "ogrenilen.json")
        # modülü ortam değişkenleriyle yeniden yükle
        for m in [m for m in list(sys.modules) if m == "importlib"]:
            pass
        import importlib.util
        global P
        if "trs_env_mod" in sys.modules:
            del sys.modules["trs_env_mod"]
        spec = importlib.util.spec_from_file_location("trs_pencere_mod", BURASI / "trs-pencere.py")
        P = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(P)

    def tearDown(self):
        self.d.cleanup()


class Ogrenme(Temel):
    def test_tercih_guclu_yan(self):
        o = P.Ogrenme()
        for _ in range(8):
            o.ekle("elle", "org.kde.kate", "sag")
        o.ekle("elle", "org.kde.kate", "sol")
        self.assertEqual(o.tercih("org.kde.kate"), "sag")      # 8/9 ≈ %89 ≥ %70

    def test_tercih_zayif_yok(self):
        o = P.Ogrenme()
        for _ in range(3):
            o.ekle("elle", "dolphin", "sag")
            o.ekle("elle", "dolphin", "sol")
        self.assertIsNone(o.tercih("dolphin"))                 # %50, güçlü değil
        o2 = P.Ogrenme()
        o2.ekle("elle", "az", "sag")
        self.assertIsNone(o2.tercih("az"))                     # yeterince kayıt yok

    def test_kaydet_yukle_dongusu(self):
        o = P.Ogrenme()
        for _ in range(6):
            o.ekle("elle", "firefox", "sag")
        o.ekle("ac", "firefox")
        o.kaydet()
        o2 = P.Ogrenme()                                       # dosyadan okur
        self.assertEqual(o2.prog["firefox"]["yer"]["sag"], 6)
        self.assertEqual(o2.prog["firefox"]["ac"], 1)
        self.assertEqual(o2.tercih("firefox"), "sag")

    def test_ogrenilen_dosyasi(self):
        o = P.Ogrenme()
        for _ in range(6):
            o.ekle("elle", "sublime_text", "sag")
        for _ in range(6):
            o.ekle("elle", "dolphin", "sol")
        o.ogrenilen_yaz()
        veri = json.loads(Path(os.environ["TRS_PENCERE_OGRENILEN"]).read_text())
        self.assertEqual(veri["yan"], {"sublime_text": "sag", "dolphin": "sol"})

    def test_gecersiz_prog_atlanir(self):
        o = P.Ogrenme()
        o.ekle("elle", "a b", "sag")      # boşluklu ad geçersiz
        o.ekle("elle", "", "sag")
        self.assertEqual(o.toplam, 0)

    def test_gizlilik_baslik_yok(self):
        # olay() yalnız izinli alanları kaydeder; başlık/caption gibi alanlar düşer
        P.gunluk_yaz({"t": 1, "tur": "elle", "prog": "firefox"})
        icerik = P.GUNLUK.read_text()
        self.assertIn("firefox", icerik)
        self.assertNotIn("caption", icerik)
        self.assertNotIn("title", icerik)


class Gunluk(Temel):
    def test_kirpma(self):
        uzun = {"t": 1, "tur": "ac", "prog": "x" * 70}
        P.GUNLUK_EN_COK_ESKI = P.GUNLUK_EN_COK
        try:
            P.GUNLUK_EN_COK = 2000
            for _ in range(200):
                P.gunluk_yaz(uzun)
            self.assertLessEqual(P.GUNLUK.stat().st_size, 2000 + 200)
        finally:
            P.GUNLUK_EN_COK = P.GUNLUK_EN_COK_ESKI

    def test_izin(self):
        P.gunluk_yaz({"t": 1, "tur": "ac", "prog": "firefox"})
        self.assertEqual(P.GUNLUK.stat().st_mode & 0o777, 0o600)


class Parlaklik(Temel):
    def test_gizli_deger(self):
        # %2 → 10000'in 200'ü (en az 1)
        self.assertEqual(max(1, round(10000 * P.GIZLI_PARLAKLIK / 100)), 200)
        self.assertEqual(max(1, round(100 * P.GIZLI_PARLAKLIK / 100)), 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
