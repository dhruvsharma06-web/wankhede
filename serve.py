# Dev server: static files with caching off, so edited ES modules reload. Usage: python serve.py [port]
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
print(f'Wankhede Seat Explorer on http://localhost:{port}')
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
