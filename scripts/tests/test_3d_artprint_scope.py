import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_3d_artprint_scope import classify

class ScopeTests(unittest.TestCase):
    def test_safe_3d_only(self):
        self.assertEqual(classify(["admin/3d-artprint.css", "admin/assets/3d-artprint/logo.png"]), [])
    def test_protect_cashier(self):
        self.assertEqual(classify(["admin/3d-artprint.js", "kassa/app.js"]), ["kassa/app.js"])
    def test_protect_shared_auth(self):
        self.assertEqual(classify(["admin/3d-artprint.html", "admin/guard.js"]), ["admin/guard.js"])
    def test_other_pr_unaffected(self):
        self.assertEqual(classify(["kassa/app.js", "desktop-kassa/main.js"]), [])
    def test_protect_migrations(self):
        self.assertEqual(classify(["docs/3D_ARTPRINT_CABINET.md", "supabase/migrations/example.sql"]), ["supabase/migrations/example.sql"])

if __name__ == "__main__":
    unittest.main()
