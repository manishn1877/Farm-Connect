#!/usr/bin/env python3
"""
FarmConnect price server (Python standard library only).

 - Pulls the official daily mandi prices (Agmarknet via data.gov.in) every few hours.
 - Serves the website files AND /data/prices.json, so every open page updates itself.
 - Adds CORS, so the site can also live on GitHub Pages and read prices from this server.

Run:   DATA_GOV_API_KEY=yourkey python3 server/price_server.py
Env:   PORT (8000)  REFRESH_HOURS (3)  FC_STATE (Karnataka)  ALLOW_ORIGIN (*)
"""
import os, sys, threading, time, json, http.server, socketserver, functools
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
os.environ.setdefault("FC_OUT", os.path.join(ROOT, "data", "prices.json"))
import fetch_prices

PORT = int(os.environ.get("PORT", "8000"))
EVERY = float(os.environ.get("REFRESH_HOURS", "3")) * 3600
ORIGIN = os.environ.get("ALLOW_ORIGIN", "*")
status = {"last_run": None, "ok": None, "message": "not run yet"}

def refresh_loop():
    while True:
        try:
            fetch_prices.main()
            status.update(ok=True, message="updated")
        except SystemExit as e:
            status.update(ok=False, message=str(e))
        except Exception as e:
            status.update(ok=False, message="error: %s" % e)
        status["last_run"] = time.strftime("%Y-%m-%d %H:%M:%S")
        print("[prices]", status["message"], status["last_run"], flush=True)
        time.sleep(EVERY)

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        if self.path.split("?")[0].endswith(("prices.json", "/status")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def do_GET(self):
        if self.path.split("?")[0] == "/status":
            b = json.dumps(status).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        super().do_GET()
    def log_message(self, *a): pass

if __name__ == "__main__":
    threading.Thread(target=refresh_loop, daemon=True).start()
    class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
    print("FarmConnect on http://localhost:%d  (prices refresh every %.1f h)" % (PORT, EVERY / 3600), flush=True)
    S(("0.0.0.0", PORT), functools.partial(Handler, directory=ROOT)).serve_forever()
