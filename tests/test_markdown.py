import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "tests", "markdown_test.js")


class MarkdownRendererTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_renderer_in_node(self):
        result = subprocess.run(["node", SCRIPT], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("markdown renderer tests passed", result.stdout)

    def test_app_js_is_ascii_and_has_no_comments(self):
        with open(os.path.join(ROOT, "public", "app.js"), "rb") as handle:
            text = handle.read().decode("ascii")
        for line in text.splitlines():
            stripped = line.strip()
            self.assertFalse(stripped.startswith("//"), line)
            self.assertFalse(stripped.startswith("/*"), line)


if __name__ == "__main__":
    unittest.main()
